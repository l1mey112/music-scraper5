import { blob, index, integer, real, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { AlbumId, ArtistId, FSRef, Ident, ImageKind, Link, Locale, LocaleDesc, PassHashed, QueueId, TrackId } from "./types";

export const $track = sqliteTable('track', {
	id: integer('id').$type<TrackId>().primaryKey(),

	isrc: text('isrc'),
}, (t) => ({
	idx0: index('track.isrc.idx0').on(t.isrc),
}))

export const $album = sqliteTable('album', {
	id: integer('id').$type<AlbumId>().primaryKey(),
})

export const $artist = sqliteTable('artist', {
	id: integer('id').$type<ArtistId>().primaryKey(),
})

// search where track_id = ?, order by id asc
// unfortunately, can't find a way to perform order by rowid optimisations, the id needs to be placed inside the index
// - SEARCH track_artist USING COVERING INDEX track_artist.idx0 (track_id=?)
export const $track_artist = sqliteTable('track_artist', {
	id: integer('id').primaryKey({ autoIncrement: true }), // monotonically increasing will preserve sort order
	track_id: integer('track_id').$type<TrackId>().notNull(),
	artist_id: integer('artist_id').$type<ArtistId>().notNull(),
}, (t) => ({
	idx0: index('track_artist.idx0').on(t.track_id, t.id, t.artist_id),
	unq: unique('track_artist.unq').on(t.track_id, t.artist_id),
}))

// TODO: should probably store exact idx and disc number
export const $album_track = sqliteTable('album_track', {
	id: integer('id').primaryKey({ autoIncrement: true }), // monotonically increasing will preserve sort order
	album_id: integer('album_id').$type<AlbumId>().notNull(),
	track_id: integer('track_id').$type<TrackId>().notNull(),
}, (t) => ({
	idx0: index('album_track.idx0').on(t.album_id, t.id, t.track_id),
	unq: unique('album_track.unq').on(t.album_id, t.track_id),
}))

// persistent store
// WITHOUT-ROWID: kv_store
export const $kv_store = sqliteTable('kv_store', {
	kind: text('kind').primaryKey(),
	data: text('data', { mode: 'json' }).notNull(),
})

// WITHOUT-ROWID: youtube_video
export const $youtube_video = sqliteTable('youtube_video', {
	id: text('id').primaryKey(),
	track_id: integer('track_id').$type<TrackId>().notNull(),

	channel_id: text('channel_id').notNull(),
})

// WITHOUT-ROWID: youtube_channel
export const $youtube_channel = sqliteTable('youtube_channel', {
	id: text('id').primaryKey(),
	artist_id: integer('artist_id').$type<ArtistId>().notNull(),

	handle: text('handle'), // @channel
})

// WITHOUT-ROWID: spotify_track
export const $spotify_track = sqliteTable('spotify_track', {
	id: text('id').primaryKey(),
	track_id: integer('track_id').$type<TrackId>().notNull(),

	preview_url: text('preview_url'),
})

// WITHOUT-ROWID: spotify_artist
export const $spotify_album = sqliteTable('spotify_album', {
	id: text('id').primaryKey(),
	album_id: integer('album_id').$type<AlbumId>().notNull(),
})

// WITHOUT-ROWID: spotify_artist
export const $spotify_artist = sqliteTable('spotify_artist', {
	id: text('id').primaryKey(),
	artist_id: integer('artist_id').$type<ArtistId>().notNull(),
})

// rowid + composite unique index has a better query plans than without-rowid + composite primary key.
// - SEARCH external_links USING COVERING INDEX external_links.idx0 (kind=?)
//
// TODO: i wonder how much space we waste by keeping these indices
//       use sqlite3_analyzer to check the size of the table with and without indices
export const $external_links = sqliteTable('external_links', {
	ident: text('ident').$type<Ident>().notNull(),
	kind: integer('kind').$type<Link>().notNull(),
	data: text('data').notNull(),
	dead: integer('dead', { mode: 'boolean' }).default(false).notNull(),
}, (t) => ({
	idx0: uniqueIndex('external_links.idx0').on(t.kind, t.ident, t.data),
	idx1: index('external_links.idx1').on(t.ident, t.kind, t.data),
}))

// same above goes for the locale table
export const $locale = sqliteTable('locale', {
	ident: text('ident').$type<Ident>().notNull(),
	locale: text('locale').$type<Locale>(),
	preferred: integer('preferred', { mode: 'boolean' }).notNull(),
	desc: integer('desc').$type<LocaleDesc>().notNull(),
	text: text('text').notNull(),
}, (t) => ({
	idx0: index('locale.searching_idx').on(t.ident, t.text, t.desc),
	uniq: unique('locale.uniq').on(t.locale, t.desc, t.text),
}))

// FIFO queue, 0 expiry means immediate. use `order by expiry asc`
export const $queue = sqliteTable('queue', {
	id: integer('id').$type<QueueId>().primaryKey({ autoIncrement: true }), // stable rowid
	pass: integer('pass').$type<PassHashed>().notNull(),
	payload: text('payload', { mode: "json" }).notNull(), // data decided by the work cmd
	preferred_time: integer('preferred_time'), // unix millis, used for inserting at a specific time

	expiry: integer('expiry').default(0).notNull(), // unix millis, zero for immediate
	try_count: integer('try_count').default(0).notNull(), // amount of tries thus far
}, (t) => ({
	idx0: index('queue.idx0').on(t.expiry, t.pass),
	uniq: unique('queue.uniq').on(t.pass, t.payload), // unique for removing duplicates
}))

// WITHOUT-ROWID: image
export const $image = sqliteTable('image', {
	hash: text('hash').$type<FSRef>().primaryKey(),
	preferred: integer('preferred', { mode: 'boolean' }).notNull(),
	ident: text('ident').$type<Ident>().notNull(),
	kind: integer('kind').$type<ImageKind>().notNull(),
	width: integer('width').notNull(),
	height: integer('height').notNull(),
	immutable_url: text('immutable_url'), // url that will always return this image
}, (t) => ({
	pkidx: index("images.ident_idx").on(t.ident, t.hash),
	pkimm: unique("images.immutable_url_uniq").on(t.immutable_url),
}))

// chromaprint is a 32-bit integer array, usually bounded by 120 seconds or less
// this doesn't represent the entire length of the audio
// one second is ~7.8 uint32s

// compression of a chromaprint is a BAD idea, the entropy is already way too high
// i tried, you'll save 100 bytes in 4000, not worth it

// acoustid performs interning of chromaprint/fingerprints. as much as i would like
// to do this (saving 5.59KiBs * 1 less chromaprint), it increases complexity and
// i hate it when queries have multiple indirections

// a source is a video/audio file, always containing some form of audio
// width and height are optional, they are only present in video sources
// WITHOUT-ROWID: source
export const $source = sqliteTable('source', {
	hash: text('hash').$type<FSRef>().primaryKey(),
	track_id: integer('track_id').$type<TrackId>().notNull(),
	bitrate: integer('bitrate').notNull(), // in kbps (bitrate, not sample rate)
	chromaprint: blob('chromaprint').$type<Uint8Array>(),
	duration_s: real('duration_s'), // not accurate to source, but within 7 seconds
}, (t) => ({
	idx0: index("source.audio_fingerprint_idx").on(t.duration_s, t.chromaprint, t.hash),
	idx1: index("source.search_bitrate_idx").on(t.track_id, t.bitrate),
}))
