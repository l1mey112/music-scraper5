import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const $artist_track = sqliteTable('artist_track', {
    id: integer('id').primaryKey({ autoIncrement: true }), // monotonically increasing will preserve sort order
})

// persistent store
// WITHOUT-ROWID: kv_store
export const $kv_store = sqliteTable('kv_store', {
	kind: text('kind').primaryKey(),
	data: text('data', { mode: 'json' }).notNull(),
})
