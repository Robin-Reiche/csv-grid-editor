// The true/false spellings a CSV really uses, and how to flip one without
// changing anything else about it (issue #41).
//
// A CSV has no boolean type, only words, and every file picks its own pair:
// true/false, yes/no, y/n, t/f, on/off. Drawing a checkbox must not turn that
// into one house style, so the file's own word is what goes back in, in the
// case and with the padding it already had. Flipping "YES" gives "NO",
// flipping "T" gives "F", flipping " true " gives " false ".
//
// 1/0 is deliberately absent. A column of ones and zeros reads just as well as
// counts, and the type detector already keeps it numeric for that reason
// (grid/column-type.ts), so a box would be a guess about what the file means.

export const BOOL_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['true', 'false'],
    ['yes',  'no'],
    ['y',    'n'],
    ['t',    'f'],
    ['on',   'off'],
];

// Which pair a value belongs to, or -1 for anything that is not one of these
// words. Empty is not a pair member: a blank cell is a missing answer, not a
// false one, and a box has no way to say "blank".
export function boolPairIndex(value: string): number {
    const token = value.trim().toLowerCase();
    if (token === '') return -1;
    for (let i = 0; i < BOOL_PAIRS.length; i++) {
        if (BOOL_PAIRS[i][0] === token || BOOL_PAIRS[i][1] === token) return i;
    }
    return -1;
}

// true, false, or null when the value is not one of the known words.
export function readBool(value: string): boolean | null {
    const i = boolPairIndex(value);
    if (i < 0) return null;
    return value.trim().toLowerCase() === BOOL_PAIRS[i][0];
}

// Rewrites `sample`'s capitalisation onto `word`: "FALSE" from "TRUE", "No"
// from "Yes", "n" from "y". Mixed case that is neither all caps nor merely
// capitalised ("tRuE") falls back to lower case, which is the common spelling.
function matchCase(word: string, sample: string): string {
    if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
    const rest = sample.slice(1);
    if (sample[0] === sample[0].toUpperCase() && rest === rest.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
}

// The opposite of this value, written the way this value is written, or null
// when the value is not a known true/false word. Null means "leave it alone":
// nothing outside the two words of the pair is ever rewritten.
export function flipBoolValue(value: string): string | null {
    const i = boolPairIndex(value);
    if (i < 0) return null;
    const token = value.trim();
    const lead  = value.slice(0, value.indexOf(token));
    const tail  = value.slice(lead.length + token.length);
    const [yes, no] = BOOL_PAIRS[i];
    const next = token.toLowerCase() === yes ? no : yes;
    return lead + matchCase(next, token) + tail;
}
