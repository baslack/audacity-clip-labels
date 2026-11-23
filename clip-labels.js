// Clip Labels for Audacity 4.0.x
//
// Adds one region label per audio clip on the selected track(s), with an
// auto-incrementing code such as TST_1000, TST_1100, ... in timeline order.
// Then use File > Export Audio with "split by labels" to get one file per clip.
//
// The naming logic below is plain JS with no Audacity dependencies so it can be
// unit-tested in node. Audacity-only modules are required lazily inside process().

var DEFAULTS = {
    prefix: "TST",
    start: 1000,
    step: 100,
    padding: 4,
    separator: "_",
    includeClipName: false
};

var INVALID_FILENAME_CHARS = /[<>:"\/\\|?*\u0000-\u001f]/;
var MAX_CLIP_NAME_LENGTH = 60;

function pad(number, width) {
    var text = String(number);
    while (text.length < width) {
        text = "0" + text;
    }
    return text;
}

// Clip titles come from the project, so clean them silently instead of failing.
function sanitizeClipName(name) {
    var text = String(name === undefined || name === null ? "" : name);
    text = text.replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "-");
    text = text.replace(/\s+/g, " ");
    text = text.replace(/^[\s.]+|[\s.]+$/g, "");
    if (text.length > MAX_CLIP_NAME_LENGTH) {
        text = text.substring(0, MAX_CLIP_NAME_LENGTH).replace(/[\s.]+$/g, "");
    }
    return text;
}

function parseInteger(value, label, minimum, maximum) {
    var text = String(value).trim();
    if (!/^-?\d+$/.test(text)) {
        return { error: label + " must be a whole number." };
    }
    var number = parseInt(text, 10);
    if (number < minimum || number > maximum) {
        return { error: label + " must be between " + minimum + " and " + maximum + "." };
    }
    return { value: number };
}

// Returns { config } on success or { error } with a message for the user.
// Prefix and separator are validated (not silently changed) because they are the
// sequence code the user chose; they end up in file names.
function parseSettings(settings) {
    var s = settings || {};
    var prefix = s.prefix === undefined ? DEFAULTS.prefix : String(s.prefix).trim();
    var separator = s.separator === undefined ? DEFAULTS.separator : String(s.separator);

    if (prefix.length === 0) {
        return { error: "Sequence code cannot be empty." };
    }
    if (INVALID_FILENAME_CHARS.test(prefix) || /[\s.]$/.test(prefix)) {
        return { error: "Sequence code contains characters that are not allowed in file names." };
    }
    if (INVALID_FILENAME_CHARS.test(separator)) {
        return { error: "Separator contains characters that are not allowed in file names." };
    }

    var start = parseInteger(s.start === undefined ? DEFAULTS.start : s.start, "Start number", 0, 99999999);
    if (start.error) { return start; }
    var step = parseInteger(s.step === undefined ? DEFAULTS.step : s.step, "Step", 1, 1000000);
    if (step.error) { return step; }
    var padding = parseInteger(s.padding === undefined ? DEFAULTS.padding : s.padding, "Zero padding", 1, 8);
    if (padding.error) { return padding; }

    var includeClipName = s.includeClipName === undefined ? DEFAULTS.includeClipName : !!s.includeClipName;

    return {
        config: {
            prefix: prefix,
            separator: separator,
            start: start.value,
            step: step.value,
            padding: padding.value,
            includeClipName: includeClipName
        }
    };
}

// tracks: array of { clips: [{start, end, title}] }. Returns clips in timeline order,
// ties broken by track order then end time. (Audacity does not return clips sorted.)
function collectClips(tracks) {
    var items = [];
    for (var t = 0; t < tracks.length; t++) {
        var clips = tracks[t].clips;
        for (var c = 0; c < clips.length; c++) {
            items.push({
                track: t,
                order: c,
                start: clips[c].start,
                end: clips[c].end,
                title: clips[c].title
            });
        }
    }
    items.sort(function (a, b) {
        if (a.start !== b.start) { return a.start - b.start; }
        if (a.track !== b.track) { return a.track - b.track; }
        if (a.end !== b.end) { return a.end - b.end; }
        return a.order - b.order;
    });
    return items;
}

// Returns { labels: [{start, end, text}] } or { error }.
function buildLabels(items, config) {
    if (items.length === 0) {
        return { error: "No clips found on the selected track(s)." };
    }
    var limit = Math.pow(10, config.padding) - 1;
    var last = config.start + config.step * (items.length - 1);
    if (last > limit) {
        return {
            error: items.length + " clips from " + config.start + " in steps of " + config.step +
                " would reach " + last + ", which needs more than " + config.padding +
                " digits. Change the sequence code, start number or step."
        };
    }
    var labels = [];
    for (var i = 0; i < items.length; i++) {
        var text = config.prefix + config.separator + pad(config.start + config.step * i, config.padding);
        if (config.includeClipName) {
            var name = sanitizeClipName(items[i].title);
            if (name.length > 0) {
                text += "_" + name;
            }
        }
        labels.push({ start: items[i].start, end: items[i].end, text: text });
    }
    return { labels: labels };
}

function createEffect() {
    return {
        parameters: function () {
            return [
                { id: "prefix", name: "Sequence code", description: "Prefix for every label, e.g. TST", type: "string", defaultValue: DEFAULTS.prefix },
                { id: "start", name: "Start number", type: "int64", defaultValue: DEFAULTS.start, min: 0, max: 99999999, step: 1 },
                { id: "step", name: "Step", type: "int64", defaultValue: DEFAULTS.step, min: 1, max: 1000000, step: 1 },
                { id: "padding", name: "Zero padding", description: "Number of digits", type: "int64", defaultValue: DEFAULTS.padding, min: 1, max: 8, step: 1 },
                { id: "separator", name: "Separator", description: "Between the code and the number", type: "string", defaultValue: DEFAULTS.separator },
                { id: "includeClipName", name: "Append clip name", type: "bool", defaultValue: DEFAULTS.includeClipName }
            ];
        },

        validate: function (settings) {
            var parsed = parseSettings(settings);
            return parsed.error ? parsed.error : true;
        },

        process: function (settings, session, task) {
            var Log = require("MuseApi.Log");
            var Project = require("Audacity.Project");

            var parsed = parseSettings(settings);
            if (parsed.error) {
                throw new Error(parsed.error);
            }

            var edit = Project.beginEdit("Label Clips", session);
            try {
                var tracks = edit.audioTracks;
                if (!tracks || tracks.length === 0) {
                    throw new Error("Select an audio track first.");
                }
                var built = buildLabels(collectClips(tracks), parsed.config);
                if (built.error) {
                    throw new Error(built.error);
                }

                var labelTrack = edit.createLabelTrack("Clip codes");
                for (var i = 0; i < built.labels.length; i++) {
                    var label = built.labels[i];
                    if (!labelTrack.addLabel(label.start, label.end, label.text)) {
                        throw new Error("Could not add label " + label.text);
                    }
                }
                edit.commit();
                Log.info("clip-labels: added " + built.labels.length + " labels, " +
                    built.labels[0].text + " .. " + built.labels[built.labels.length - 1].text);
                return true;
            } catch (e) {
                edit.abort();
                throw e;
            }
        }
    };
}

if (typeof exports !== "undefined") {
    exports.createEffect = createEffect;
    // Exposed for unit tests only.
    exports.__test = {
        pad: pad,
        sanitizeClipName: sanitizeClipName,
        parseSettings: parseSettings,
        collectClips: collectClips,
        buildLabels: buildLabels
    };
}
