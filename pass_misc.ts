import { InferInsertModel, SQL, sql } from "drizzle-orm"
import { db, sqlite } from "./db"
import { $album, $artist, $track_artist, $external_links, $locale, $queue, $spotify_album, $spotify_artist, $spotify_track, $track, $youtube_channel, $youtube_video, $album_track, $image, $source } from "./schema"
import { snowflake_id, snowflake_id_with } from "./ids"
import { AlbumEntry, AlbumId, ArtistEntry, ArtistId, Ident, ImageKind, Link, LinkEntry, LocaleEntry, MaybePromise, PassHashed, QueueEntry, Snowflake, TrackEntry, TrackId } from "./types"
import { SQLiteTable } from "drizzle-orm/sqlite-core"
import { rowId } from "drizzle-orm/sqlite-core/expressions"
import { queue_dispatch_immediate } from "./pass"
import { wal_link } from "./wal"

export function not_exists<T>(table: SQLiteTable, cond: SQL) {
	return db.select({ _: sql`1` })
		.from(table)
		.where(cond)
		.get() === undefined
}

// results in short circuiting if the id exists, better than using a union
const id_exists_stmt = sqlite.prepare<{ found: 0 | 1 }, [TrackId | AlbumId | ArtistId]>(`
	select
		case
			when exists (select 1 from track where id = ?1) then 1
			when exists (select 1 from album where id = ?1) then 1
			when exists (select 1 from artist where id = ?1) then 1
			else 0
		end as found
	limit 1;
`)

function id_exists(id: TrackId | AlbumId | ArtistId) {
	return id_exists_stmt.get(id)?.found === 1
}

function object_has_any(data: any): boolean {
	if (typeof data !== 'object') {
		return false
	}

	for (const i in data) {
		if (data[i] !== undefined && data[i] !== null) {
			return true
		}
	}

	return false
}

export type ArticleKind = 'track_id' | 'album_id' | 'artist_id'

type KindToId = {
	track_id: TrackId
	album_id: AlbumId
	artist_id: ArtistId
}

type KindToEntry = {
	track_id: TrackEntry
	album_id: AlbumEntry
	artist_id: ArtistEntry
}

const kind_desc: Record<ArticleKind, SQLiteTable> = {
	track_id: $track,
	album_id: $album,
	artist_id: $artist,
}

export function get_ident_or_new<T extends ArticleKind>(preferred_time: number | null | undefined, foreign_id: string, foreign_table: SQLiteTable, kind: T, aux?: Omit<KindToEntry[T], 'id'>): [Ident, KindToId[T]] {
	let data: [Ident, KindToId[T]] | undefined

	const a = db.select({ id: sql<KindToId[T]>`${sql.identifier(kind)}` })
		.from(foreign_table)
		.where(sql`id = ${foreign_id}`)
		.get()

	if (a) {
		data = [ident_make(a.id, kind), a.id]
	}

	if (!data) {
		let id
		if (preferred_time) {			
			// create a new snowflake id with a preferred time

			let seq = 0
			while (true) {
				id = snowflake_id_with(preferred_time, seq++) as KindToId[T]
				if (!id_exists(id)) {
					break
				}

				console.log(`get_ident_or_new: retrying (seq: ${seq})`, id)
			}
		} else {
			id = snowflake_id() as KindToId[T]
		}

		data = [ident_make(id, kind), id]
	}

	const pk_table = kind_desc[kind]

	const naux = (aux ?? {}) as KindToEntry[T]

	if (object_has_any(aux)) {
		db.insert(pk_table)
			.values({ ...naux, id: data[1] })
			.onConflictDoUpdate({
				target: sql`${pk_table}."id"`,
				set: naux,
			})
			.run()
	} else {
		db.insert(pk_table)
			.values({ ...{} as KindToEntry[T], id: data[1] })
			.onConflictDoNothing()
			.run()
	}

	return data
}

// throws if not exists
export function get_ident<T extends ArticleKind>(foreign_id: string, foreign_table: SQLiteTable, kind: T): [Ident, KindToId[T]] {
	const a = db.select({ id: sql<KindToId[T]>`${sql.identifier(kind)}` })
		.from(foreign_table)
		.where(sql`id = ${foreign_id}`)
		.get()

	assert(a, `foreign key not found (${foreign_id})`)

	return [ident_make(a.id, kind), a.id]
}

export function ident_link_command(ident: Ident): string {
	let thirdparty: [prefix: string, SQLiteTable][]

	const kind = ident_classify(ident)
	const prefix = ident_prefix(ident)
	const id = ident_id(ident)

	switch (kind) {
		case 'track_id': {
			thirdparty = [
				['yt', $youtube_video],
				['sp', $spotify_track],
			]
			break
		}
		case 'album_id': {
			thirdparty = [
				['sp', $spotify_album],
			]
			break
		}
		case 'artist_id': {
			thirdparty = [
				['yt', $youtube_channel],
				['sp', $spotify_artist],
			]
			break
		}
	}

	// {ident_prefix}.{thirdparty_prefix}:xxxxxxxxxxx, ...

	const components = []

	for (const [prefix, table] of thirdparty) {
		const a = db.select({ id: sql`id` })
			.from(table)
			.where(sql`${sql.identifier(kind)} = ${id}`)
			.all()

		for (const i of a) {
			components.push(`${prefix}:${i.id}`)
		}
	}

	return `${prefix}.${components.join(',')}`
}

export function merge<T extends ArticleKind>(kind: T, id1: KindToId[T], id2: KindToId[T]) {
	assert(kind !== 'album_id') // not implemented yet

	// id1 <- id2
	// merge into oldest

	if (id1 > id2) {
		let tmp = id1
		id1 = id2
		id2 = tmp
	}

	const migration_tables_ident = [
		$image,
		$locale,
		$external_links,
	]

	let primary: SQLiteTable
	let migration_tables_id: SQLiteTable[]

	switch (kind) {
		case 'track_id': {
			primary = $track
			migration_tables_id = [
				$track_artist, $album_track,
				$youtube_video, $spotify_track,
				$source,
			]
			break
		}
		case 'album_id': {
			primary = $album
			migration_tables_id = [
				$album_track,
				$spotify_album,
			]
			break
		}
		case 'artist_id': {
			primary = $artist
			migration_tables_id = [
				// $track_artist, (IMPLEMENTED BELOW)
				$spotify_artist,
				$youtube_channel,
			]
			break
		}
		default: {
			assert(false)
		}
	}

	const ident1 = ident_make(id1, kind)
	const ident2 = ident_make(id2, kind)

	// merge id2 into id1
	db.transaction(db => {
		if (kind === 'artist_id') {
			// merge two artist ids together, preserving the order placing the resultant artist id FIRST

			// track attribution result of merging two tracks:
			// - cosMo@Bousou-P, 音街ウナ, Hatsune Miku, cosMo@暴走P

			// result after naively merging the artists together
			// - 音街ウナ, Hatsune Miku, cosMo@Bousou-P
			// we don't want this there ^^^^^^^^^^^^^

			// TODO: this is quite redundant, we're only matching on two things here
			const mapping_ids = db.select({ id: $track_artist.id, track_id: $track_artist.track_id })
				.from($track_artist)
				.where(sql`artist_id = ${id1} or artist_id = ${id2}`)
				.all()

			// perform group by track_id, sqlite doesn't have aggregate array functions
			const track_artist_grouped = new Map<TrackId, number[]>()
			for (const i of mapping_ids) {
				const arr = track_artist_grouped.get(i.track_id) ?? []
				arr.push(i.id)
				track_artist_grouped.set(i.track_id, arr)
			}

			for (const [_, mapping_ids] of track_artist_grouped) {
				// sort by lowest first
				mapping_ids.sort((a, b) => a - b)
				const first_artist = mapping_ids.shift()

				if (first_artist) {
					try {
						db.update($track_artist)
							.set({ artist_id: id1 as ArtistId })
							.where(sql`id = ${first_artist}`)
							.run()
					} catch {
						// ignore
					}
				}

				for (const attribute_map of mapping_ids) {
					db.delete($track_artist)
						.where(sql`id = ${attribute_map}`)
						.run()
				}
			}
		}

		for (const table of migration_tables_id) {
			try {
				db.update(table)
					.set({ [kind]: id1 })
					.where(sql`${sql.identifier(kind)} = ${id2}`)
					.run()
			} catch {
				// ignore
			}
		}

		for (const table of migration_tables_ident) {
			try {
				db.update(table)
					.set({ ident: ident1 })
					.where(sql`ident = ${ident2}`)
					.run()
			} catch {
				// ignore
			}
		}

		// perform a merge using two selects, merge object, then delete and update
		// it is convoluted and slow, but simpler logic using JS and typechecked using drizzle

		const id1_obj = db.select()
			.from(primary)
			.where(sql`id = ${id1}`)
			.get() ?? {}

		const id2_obj = db.select()
			.from(primary)
			.where(sql`id = ${id2}`)
			.get() ?? {}

		// remove all keys that are undefined or null
		function clear_null(obj: any) {
			for (const key in obj) {
				if (obj[key] === undefined || obj[key] === null) {
					delete obj[key]
				}
			}
		}

		clear_null(id1_obj)

		const merged_obj = {
			...id2_obj,
			...id1_obj,
		}

		delete (merged_obj as any).id // sure

		db.delete(primary)
			.where(sql`id = ${id2}`)
			.run()

		if (object_has_any(merged_obj)) {
			// upsert
			db.insert(primary)
				.values({ ...merged_obj, id: id1 })
				.onConflictDoUpdate({
					target: sql`${primary}."id"`,
					set: merged_obj,
				})
				.run()
		} else {
			db.insert(primary)
				.values({ id: id1 })
				.onConflictDoNothing()
				.run()
		}

		// log the merge
		wal_link(ident1)
	})
}

export function link_insert(link: LinkEntry | LinkEntry[]) {
	if (link instanceof Array) {		
		if (link.length === 0) {
			return
		}
	} else {
		link = [link]
	}

	// sometimes people paste links without https://
	for (const i of link) {
		if (i.kind != Link["Unknown URL"]) {
			continue
		}

		if (!i.data.startsWith('http://') && !i.data.startsWith('https://')) {
			i.data = 'https://' + i.data
		}
	}

	db.insert($external_links)
		.values(link)
		.onConflictDoNothing()
		.run()
}

export function link_delete(link: LinkEntry & { rowid: number }) {
	db.delete($external_links)
		.where(sql`rowid = ${link.rowid}`)
		.run()
}

export function link_kill(link: LinkEntry & { rowid: number }) {
	db.update($external_links)
		.set({ dead: true })
		.where(sql`rowid = ${link.rowid}`)
		.run()
}

export function link_select(kind: Link[] | Link = Link["Unknown URL"]): (LinkEntry & { rowid: number })[] {
	if (!(kind instanceof Array)) {
		kind = [kind]
	}

	const k = db.select({
		rowid: rowId(),
		ident: $external_links.ident,
		kind: $external_links.kind,
		data: $external_links.data,
	})
		.from($external_links)
		.where(sql`kind in ${kind} and dead = 0`)
		.all()

	return k
}

export function link_urls_unknown(ident: Ident, urls: string[]): LinkEntry[] {
	return urls.map(url => ({
		ident,
		kind: Link["Unknown URL"],
		data: url,
	}))
}

export function locale_insert(locales: LocaleEntry | LocaleEntry[]) {
	if (locales instanceof Array && locales.length == 0) {
		return
	}

	if (!(locales instanceof Array)) {
		locales = [locales]
	}

	// union on preferred
	db.insert($locale)
		.values(locales)
		.onConflictDoUpdate({
			target: [$locale.locale, $locale.desc, $locale.text],
			set: {
				preferred: sql`${$locale.locale} or excluded.preferred`,
			}
		})
		.run()
}

// the API might return a different id (canonical), instead of the id we know (known)
// canonical <- known (into canonical)
// will completely replace rows
// no need to merge, nothing would get lost if `get_ident_or_new(table, known)` was called and used
export function insert_canonical<T extends SQLiteTable>(table: T, canonical: string, known: string, data: Omit<InferInsertModel<T>, 'id'>) {
	if (canonical !== known) {
		console.log('insert_canonical', canonical, known)
		db.delete(table)
			.where(sql`id = ${canonical}`)
			.run()
	}

	// there are bugs if you type it as Omit<InferInsertModel<T>, 'id'>
	// some properties just disappear
	delete (data as any).id

	db.insert(table)
		.values({ ...data, id: canonical } as any) // sigh
		.onConflictDoUpdate({
			target: sql`${table}."id"`,
			set: data as any, // sigh2
		})
		.run()

	if (canonical !== known) {
		db.update(table)
			.set({ id: canonical })
			.where(sql`id = ${known}`)
			.run()
	}
}

export function insert_track_artist(track_id: TrackId, artist_id: ArtistId | ArtistId[]) {
	let values

	if (!(artist_id instanceof Array)) {
		values = [{ track_id, artist_id }]
	} else {
		values = artist_id.map(artist_id => ({ track_id, artist_id }))
	}

	db.insert($track_artist)
		.values(values)
		.onConflictDoNothing()
		.run()
}

export function insert_album_track(album_id: AlbumId, track_id: TrackId | TrackId[]) {
	let values

	if (!(track_id instanceof Array)) {
		values = [{ album_id, track_id }]
	} else {
		values = track_id.map(track_id => ({ album_id, track_id }))
	}

	db.insert($album_track)
		.values(values)
		.onConflictDoNothing()
		.run()
}

export function ident_make(target: Snowflake, kind: ArticleKind): Ident {
	let prefix

	switch (kind) {
		case 'track_id':
			prefix = 'tr'
			break
		case 'album_id':
			prefix = 'al'
			break
		case 'artist_id':
			prefix = 'ar'
			break
	}

	return `${prefix}${target}` as Ident
}

export function ident_id<T extends TrackId | AlbumId | ArtistId>(id: Ident): T {
	return Number(id.slice(2)) as T
}

export function ident_prefix(id: Ident): 'tr' | 'al' | 'ar' {
	return id.slice(0, 2) as 'tr' | 'al' | 'ar'
}

export function ident_classify(ident: Ident | string): ArticleKind {
	assert(ident.length >= 3)
	switch (ident.slice(0, 2)) {
		case 'tr':
			return 'track_id'
		case 'al':
			return 'album_id'
		case 'ar':
			return 'artist_id'
	}
	assert(false, 'unreachable')
}

export function ident_classify_fallable(ident: Ident | string): ArticleKind | undefined {
	// tr<number>
	if (ident.length < 3) {
		return
	}

	switch (ident.slice(0, 2)) {
		case 'tr':
			return 'track_id'
		case 'al':
			return 'album_id'
		case 'ar':
			return 'artist_id'
	}
}

// inserts [ImageKind, string] into the queue
// it is in an array/tuple for deterministic JSON.stringify etc
export function image_queue_immutable_url(ident: Ident, kind: ImageKind, url: string, preferred: boolean) {
	queue_dispatch_immediate('image.download_image_url', [ident, kind, url, preferred])
}

// matches ...99a7_q9XuZY）←｜→次作：（しばしまたれよ）
//                       ^^^^^^^^^^^^^^^^^^^^^^^^^ very incorrect
//
// vscode uses a state machine to identify links, it also includes this code for characters that the URL cannot end in
//
// https://github.com/microsoft/vscode/blob/d6eba9b861e3ab7d1935cff61c3943e319f5c830/src/vs/editor/common/languages/linkComputer.ts#L152
// const CANNOT_END_IN = ' \t<>\'\"、。｡､，．：；‘〈「『〔（［｛｢｣｝］）〕』」〉’｀～….,;:'
//
const url_regex = /(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff-]{0,62})?[a-z0-9\u00a1-\uffff]\.)+(?:[a-z\u00a1-\uffff]{2,}\.?))(?::\d{2,5})?(?:[/?#][^\r\n \t<>'"、。｡､，．：；‘〈「『〔（［｛｢｣｝］）〕』」〉’｀～…\.,;:\(\)\[\]\{\}]*)?/ig

// there is a lot more rules here, specifically pertaining to characters that should be in the URL if it encloses the URL
// ive gone ahead and added `()[]{}` to the regex but not using this special logic
// https://github.com/microsoft/vscode/blob/d6eba9b861e3ab7d1935cff61c3943e319f5c830/src/vs/editor/common/languages/linkComputer.ts#L230

export function links_from_text(ident: Ident, text: string): LinkEntry[] {
	const url_set = new Set<string>()

	for (const url of text.matchAll(url_regex)) {
		url_set.add(url[0])
	}

	const links: LinkEntry[] = []

	for (const url of url_set) {
		links.push({
			kind: Link["Unknown URL"],
			data: url,
			ident,
		})
	}

	return links
}

export async function run_batched<T>(arr: T[], batch_size: number, next: (v: T[]) => MaybePromise<void>) {
	for (let i = 0; i < arr.length; i += batch_size) {
		const batch = arr.slice(i, i + batch_size)

		await next(batch)
	}
}

// ensure batch_fn returns the same amount of results as the input
export async function run_batched_zip<T, O>(arr: T[], batch_size: number, batch_fn: (v: T[]) => MaybePromise<O[]>, next: (v: T, k: O) => MaybePromise<void>) {
	for (let i = 0; i < arr.length; i += batch_size) {
		const batch = arr.slice(i, i + batch_size)
		const results = await batch_fn(batch)

		assert(batch.length === results.length)

		for (let i = 0; i < batch.length; i++) {
			await next(batch[i], results[i])
		}
	}
}

export async function run_with_concurrency_limit<T>(arr: Iterable<T>, concurrency_limit: number, next: (v: T) => Promise<void>) {
	const active_promises: Promise<void>[] = []
	let has_error = false

	for (const item of arr) {
		// wait until there's room for a new operation
		while (active_promises.length >= concurrency_limit) {
			await Promise.race(active_promises)
		}

		const next_operation = next(item).catch(err => {
			has_error = true
			throw err
		})
		active_promises.push(next_operation)

		next_operation.finally(() => {
			const index = active_promises.indexOf(next_operation)
			if (index !== -1) {
				active_promises.splice(index, 1)
			}
		})

		if (has_error) {
			break
		}
	}

	// wait for all active operations to complete
	await Promise.all(active_promises)
}

// functions equivalently to run_with_concurrency_limit, but with a fail limit
/* export async function run_with_concurrency_limit_with_abort<T>(arr: Iterable<T>, concurrency_limit: number, fail_limit: number, next: (v: T) => Promise<boolean>): Promise<boolean> {
	const active_promises: Promise<boolean>[] = []

	let failed = 0

	for (const item of arr) {
		if (failed >= fail_limit) {
			return false
		}

		// wait until there's room for a new operation
		while (active_promises.length >= concurrency_limit) {
			await Promise */

export function assert(condition: any, message?: string): asserts condition {
	if (!condition) {
		if (message) {
			console.error(`assertion failed: ${message}`)
		} else {
			console.error('assertion failed')
		}
		throw new Error()
		//console.log(new Error().stack)
		//process.exit(1)
	}
}
