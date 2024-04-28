import { index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { AlbumId, ArtistId, FSRef, Ident, ImageKind, Link, Locale, LocaleDesc, QueueCmdHashed, TrackId } from "./types";

export const $track = sqliteTable('track', {
    id: integer('id').$type<TrackId>().primaryKey(),

    isrc: text('isrc'),
})

export const $album = sqliteTable('album', {
    id: integer('id').$type<AlbumId>().primaryKey(),
})

export const $artist = sqliteTable('artist', {
    id: integer('id').$type<ArtistId>().primaryKey(),
})

// search where track_id = ?, order by id asc
// unfortunately, can't find a way to perform order by rowid optimisations, the id needs to be placed inside the index
// - SEARCH artist_track USING COVERING INDEX artist_track.idx0 (track_id=?)
export const $artist_track = sqliteTable('artist_track', {
    id: integer('id').primaryKey({ autoIncrement: true }), // monotonically increasing will preserve sort order
	track_id: integer('track_id').$type<TrackId>().notNull(),
	artist_id: integer('artist_id').$type<ArtistId>().notNull(),

	// role, etc
}, (t) => ({
	idx0: index('artist_track.idx0').on(t.track_id, t.id, t.artist_id),
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

// WITHOUT-ROWID: spotify_track
export const $spotify_track = sqliteTable('spotify_track', {
	id: text('id').primaryKey(),
	track_id: integer('track_id').$type<TrackId>().notNull(),

	preview_url: text('preview_url'),
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
	idx0: index('locale.idx0').on(t.ident),
	uniq: unique('locale.uniq').on(t.locale, t.desc, t.text),
}))

// FIFO queue, 0 expiry means immediate. use `order by expiry asc`
export const $queue = sqliteTable('queue', {
	target: text('target').default('').$type<Ident>().notNull(), // FK decided by `pk_ident`, '' means create a new target
	cmd: integer('cmd').$type<QueueCmdHashed>().notNull(),
	payload: text('payload', { mode: "json" }).notNull(), // data decided by the work cmd

	expiry: integer('expiry').default(0).notNull(), // unix millis, zero for immediate
	retry_count: integer('retry_count').default(0).notNull(), // amount of retries thus far
}, (t) => ({
	idx0: index('queue.idx0').on(t.expiry, t.cmd),
	uniq: unique('queue.uniq').on(t.target, t.cmd, t.payload), // unique for removing duplicates
}))

// WITHOUT-ROWID: images
export const $images = sqliteTable('images', {
	hash: text('hash').$type<FSRef>().primaryKey(),
	ident: text('ident').$type<Ident>().notNull(),
	kind: text('kind').$type<ImageKind>().notNull(),
	width: integer('width').notNull(),
	height: integer('height').notNull(),
}, (t) => ({
	pkidx: index("images.ident_idx").on(t.ident, t.hash),
}))
