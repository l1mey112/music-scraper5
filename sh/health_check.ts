#!/usr/bin/env bun

import { getTableName, sql } from "drizzle-orm"
import { db } from "../db"
import { ArticleKind } from "../pass_misc"
import { $album, $album_track, $artist, $external_links, $image, $locale, $source, $spotify_album, $spotify_artist, $spotify_track, $track, $track_artist, $youtube_channel, $youtube_video } from "../schema"
import { Ident } from "../types"
import { fs_hash_path } from "../fs"
import fs from 'fs'

const do_purge = process.argv[2] === 'purge'

const ident_tables = [
	$external_links,
	$locale,
	$image,
]

const track_id_tables = [
	$track_artist,
	$youtube_video,
	$spotify_track,
	$source,
]

const album_id_tables = [
	$album_track,
	$spotify_album,
]

const artist_id_tables = [
	$track_artist,
	$youtube_channel,
	$spotify_artist,
]

function test(kind: ArticleKind) {
	let tables
	let target_table
	
	switch (kind) {
		case 'track_id': {
			tables = track_id_tables
			target_table = $track
			break
		}
		case 'album_id': {
			tables = album_id_tables
			target_table = $album
			break
		}
		case 'artist_id': {
			tables = artist_id_tables
			target_table = $artist
			break
		}
	}

	// for every single table in the array, check if it has the column then return nothing
	// otherwise return the item that isn't in anywhere

	for (const table of tables) {
		const ids = db.all<{ id: number }>(sql`
			select g.${sql.identifier(kind)} as id
			from ${table} g
			where not exists (
				select 1
				from ${target_table} t
				where g.${sql.identifier(kind)} = t.id
			)
		`)

		if (ids.length > 0) {
			console.log(`missing ${kind}s in ${getTableName(table)}`)
			for (const { id } of ids) {
				if (!do_purge) {
					console.log(`  ${id}`)
				} else {
					db.delete(table)
						.where(sql`${sql.identifier(kind)} = ${id}`)
						.run()
				}
			}
		}
	}
}

function test_ident() {
	for (const ident_table of ident_tables) {
		const idents = db.all<{ ident: Ident }>(sql`
			select g.ident
			from ${ident_table} g
			where not exists (
				select 1
				from track t
				where substr(g.ident, 3) = t.id
			) and not exists (
				select 1
				from album a
				where substr(g.ident, 3) = a.id
			) and not exists (
				select 1
				from artist a
				where substr(g.ident, 3) = a.id
			)
		`)

		if (idents.length > 0) {
			console.log(`missing idents in ${getTableName(ident_table)}`)
			for (const { ident } of idents) {
				if (!do_purge) {
					console.log(`  ${ident}`)
				} else {
					db.delete(ident_table)
						.where(sql`ident = ${ident}`)
						.run()
				}
			}
		}
	}
}

function test_sources() {
	const sources = db.select()
		.from($source)
		.all()

	let idx = 0
	for (const source of sources) {
		const path = fs_hash_path(source.hash)
		if (!fs.existsSync(fs_hash_path(source.hash))) {
			if (!do_purge) {
				console.log(`missing source(${++idx}/${sources.length}) ${source.hash} (path: ${path})`)
			} else {
				db.delete($source)
					.where(sql`hash = ${source.hash}`)
					.run()
			}
		}
	}
}

test('track_id')
test('album_id')
test('artist_id')
test_ident()
test_sources()
