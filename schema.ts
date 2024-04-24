import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { Ident, Link, Locale, LocaleDesc } from "./types";

export const $track = sqliteTable('track', {
    id: integer('id').primaryKey(),

    isrc: text('isrc'),
})

export const $album = sqliteTable('album', {
    id: integer('id').primaryKey(),
})

export const $artist = sqliteTable('artist', {
    id: integer('id').primaryKey(),
})

// search where track_id = ?, order by id asc
// unfortunately, can't find a way to perform order by rowid optimisations
// - SEARCH artist_track USING COVERING INDEX artist_track.idx0 (track_id=?)
export const $artist_track = sqliteTable('artist_track', {
    id: integer('id').primaryKey({ autoIncrement: true }), // monotonically increasing will preserve sort order
	track_id: integer('track_id').notNull(),
	artist_id: integer('artist_id').notNull(),

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
	track_id: integer('track_id').notNull(),

	channel_id: text('channel_id').notNull(),
})

// WITHOUT-ROWID: spotify_track
export const $spotify_track = sqliteTable('spotify_track', {
	id: text('id').primaryKey(),
	track_id: integer('track_id').notNull(),
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
}))
