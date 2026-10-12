/** Every number in the rooms plan, in one place. */

export const CODE_LENGTH = 6;
/** No 0, O, 1, I or L, so a code can be read aloud. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const MAX_PEOPLE = 50;
export const NAME_MIN = 2;
export const NAME_MAX = 20;
export const ROOM_NAME_MAX = 30;
export const COLOURS = 8;

export const MAX_WAITING_EACH = 5;
export const MAX_WAITING = 100;
export const MAX_SONG_SECONDS = 15 * 60;

/** Every device gets this long to load an item before it starts. */
export const HEAD_START_MS = 3_000;

export const NOTE_MIN_SECONDS = 1;
export const NOTE_MAX_SECONDS = 20;
export const NOTE_EVERY_MS = 60_000;
export const MAX_NOTES_WAITING = 5;
export const NOTE_MAX_BYTES = 400_000;
/** A "play now" note this close to a song's end waits for the gap instead. */
export const NOTE_GAP_SECONDS = 8;
/** Time for every device to fetch a note before it plays. */
export const NOTE_LEAD_MS = 1_500;
export const NOTE_SPACING_MS = 500;
/** Music level under a voice note, and the fades around it. */
export const DUCK_LEVEL = 0.15;

/** A song eases in at its start and out at its end. */
export const FADE_IN_SECONDS = 1.2;
export const FADE_OUT_SECONDS = 2.5;
/** How long any change of loudness takes to arrive, so nothing ever snaps. */
export const GLIDE_MS = 500;
/**
 * How far a device may be from the room's timeline before it is corrected. Wide on
 * purpose: a correction interrupts the sound, and smooth playing matters more than exact timing.
 */
export const DRIFT_ALLOWED_SECONDS = 5;
/** A player must have played without a break for this long before its position is judged. */
export const STEADY_MS = 1500;


export const HOST_AWAY_MS = 60_000;
export const EMPTY_ROOM_MS = 30 * 60_000;
export const ROOM_LIFE_MS = 24 * 60 * 60_000;

export const MESSAGE_MAX_BYTES = 4_096;
