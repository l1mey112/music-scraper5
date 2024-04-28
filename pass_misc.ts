import { InferInsertModel, sql } from "drizzle-orm"
import { db, sqlite } from "./db"
import { $album, $artist, $track_artist, $external_links, $locale, $queue, $spotify_album, $spotify_artist, $spotify_track, $track, $youtube_channel, $youtube_video, $album_artist, $album_track } from "./schema"
import { snowflake } from "./ids"
import { AlbumEntry, AlbumId, ArtistEntry, ArtistId, Ident, ImageKind, Link, LinkEntry, LocaleEntry, MaybePromise, PassIdentifier, QueueCmd, QueueCmdHashed, QueueEntry, Snowflake, TrackEntry, TrackId } from "./types"
import { SQLiteTable } from "drizzle-orm/sqlite-core"
import { rowId } from "drizzle-orm/sqlite-core/expressions"

// > A value with storage class NULL is considered less than any other value
// https://www.sqlite.org/datatype3.html#sort_order

// QUERY PLAN
// `--SEARCH queue USING INDEX queue.idx0 (expiry<?)
const stmt_search = sqlite.prepare<{ rowid: number, target: Ident | '', payload: string }, [number, QueueCmdHashed]>(`
	select rowid, target, payload from queue
	where expiry <= ? and cmd = ?
	order by expiry asc
`)

export function queue_pop<T = unknown>(cmd: QueueCmd): QueueEntry<T>[] {
	const entries = stmt_search.all(Date.now(), queue_hash_cmd(cmd))

	const nentries = entries.map(it => {
		return {
			...it,
			target: it.target === '' ? undefined : it.target,
			payload: JSON.parse(it.payload) as T,
			cmd,
		}
	})

	return nentries
}

// mutate the existing queue entry to retry later
// increments `retry_count` which can be used to determine if the entry should be removed after manual review
export function queue_retry_later(entry: QueueEntry, expiry_after_millis: number = DAY) {
	db.update($queue)
		.set({ expiry: Date.now() + expiry_after_millis, try_count: sql`${$queue.try_count} + 1` })
		.where(sql`rowid = ${entry.rowid}`)
		.run()
}

// mutate the existing queue entry to retry later
// doesn't increment `retry_count`, this function is for steady retries
export function queue_again_later(entry: QueueEntry, expiry_after_millis: number = DAY) {
	db.update($queue)
		.set({ expiry: Date.now() + expiry_after_millis })
		.where(sql`rowid = ${entry.rowid}`)
		.run()
}

// remove the queue entry as it is completed
export function queue_complete(entry: QueueEntry) {
	db.delete($queue)
		.where(sql`rowid = ${entry.rowid}`)
		.run()
}

// just use cityhash32, its good enough
function queue_hash_cmd(cmd: QueueCmd): QueueCmdHashed {
	return Bun.hash.cityHash32(cmd) as QueueCmdHashed
}

type ArticleKind = 'track_id' | 'album_id' | 'artist_id'

// only nonnull when command is *.new.*
const cmd_desc: Record<QueueCmd, [SQLiteTable, ArticleKind] | null> = {
	'track.new.youtube_video': [$youtube_video, 'track_id'],
	'track.new.spotify_track': [$spotify_track, 'track_id'],
	'image.download.image_url': null,
	'artist.new.youtube_channel': [$youtube_channel, 'artist_id'],
	'album.new.spotify_album': [$spotify_album, 'album_id'],
	'artist.new.spotify_artist': [$spotify_artist, 'artist_id'],
	'artist.meta.spotify_artist_supplementary': null,
}

const kind_desc: Record<ArticleKind, SQLiteTable> = {
	track_id: $track,
	album_id: $album,
	artist_id: $artist,
}

function queue_identify_exiting_target(cmd: QueueCmd, payload: any): Ident | undefined {
	const desc = cmd_desc[cmd]
	assert(desc !== undefined, `inexhaustive match (${cmd})`)

	if (desc) {
		// the above types of commands only have a string payload
		assert(typeof payload === 'string')

		const [table, col] = desc

		const sel = db.select({ target: sql<Snowflake>`${sql.identifier(col)}` })
			.from(table)
			.where(sql`id = ${payload}`)
			.get()

		if (sel) {
			console.log('found existing target', sel.target, col, cmd)
			return ident(sel.target, col)
		}
	}
}

// dispatch a command to be executed immediately
// returning the target ident, which may or may not exist
// work entries dispatched by other entries should use this function to avoid infinite loops
export function queue_dispatch_chain_returning(cmd: QueueCmd, payload: any): Ident {
	let target: Ident | undefined = queue_identify_exiting_target(cmd, payload)

	if (target) {
		return target
	}

	if (!target) {
		// find existing commands with target

		const sel = db.select({ target: $queue.target })
			.from($queue)
			.where(sql`cmd = ${queue_hash_cmd(cmd)} and target != '' and payload = ${JSON.stringify(payload)}`)
			.get()

		if (sel) {
			console.log('found existing target by cmd', sel.target, cmd)
			return sel.target
		}
	}

	if (!target) {
		const desc = cmd_desc[cmd]
		assert(desc !== undefined, `inexhaustive match (${cmd})`)
		assert(desc !== null, 'command does not create anything')

		const [_, col] = desc

		target = ident(snowflake(), col)
	}

	queue_dispatch_immediate(cmd, payload, target)

	return target
}

function verify_new_target(pass: PassIdentifier) {
	const comp = pass.split('.')

	assert(comp[1] === 'new', `pass must be a new pass (${pass})`)
}

// dispatch a command to be executed immediately
// work entries dispatched by other entries should use this function to avoid infinite loops
export function queue_dispatch_chain_immediate(cmd: QueueCmd, payload: any, target?: Ident) {
	if (!target) {
		verify_new_target(cmd)
	}

	if (queue_identify_exiting_target(cmd, payload)) {
		return
	}

	db.insert($queue)
		.values({ cmd: queue_hash_cmd(cmd), target, payload })
		.onConflictDoUpdate({
			target: [$queue.target, $queue.cmd, $queue.payload],
			set: {
				expiry: 0,
				try_count: 0,
			}
		})
		.run()
}

// dispatch a command to be executed immediately
export function queue_dispatch_immediate(cmd: QueueCmd, payload: any, target?: Ident) {
	if (!target) {
		verify_new_target(cmd)
	}

	target ??= queue_identify_exiting_target(cmd, payload)

	db.insert($queue)
		.values({ cmd: queue_hash_cmd(cmd), target, payload })
		.onConflictDoUpdate({
			target: [$queue.target, $queue.cmd, $queue.payload],
			set: {
				expiry: 0,
				try_count: 0,
			}
		})
		.run()
}

// dispatch a command to be executed after a certain amount of time
export function queue_dispatch_later(cmd: QueueCmd, payload: any, target: Ident, expiry_after_millis: number) {	
	db.insert($queue)
		.values({ cmd: queue_hash_cmd(cmd), target, payload, expiry: Date.now() + expiry_after_millis })
		.onConflictDoUpdate({
			target: [$queue.target, $queue.cmd, $queue.payload],
			set: {
				expiry: Date.now() + expiry_after_millis,
				try_count: 0,
			}
		})
		.run()
}

export const HOUR = 1000 * 60 * 60
export const DAY = HOUR * 24

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

export function ident_cmd(entry: QueueEntry): Ident {
	assert(entry.target)
	return entry.target
}

// ensures existence of the id in the table as well
// will create in table if doesn't exist
// will set data as well
// only really applicable for commands that create new entries, as it is used to overwrite the article entry with `data`
export function ident_cmd_unwrap_new<T extends ArticleKind>(entry: QueueEntry, kind: T, _data?: Omit<KindToEntry[T], 'id'>): [Ident, KindToId[T]] {

	// identify target
	// 1. if the queue entry has a target, use that
	//    it will either not exist, or already exist
	// 2. nothing found that already exists, just autogenerate and create

	// identifying if the source id already exists then extracting the target ident
	// is already performed in `queue_identify_exiting_target`

	const data: KindToEntry[T] = _data ?? {}
	let target = entry.target

	if (!target) {
		verify_new_target(entry.cmd)
		target = ident(snowflake(), kind)
	}

	const pk_table = kind_desc[kind]

	const target_id = ident_id<KindToId[T]>(target)

	if (Object.keys(data).length > 0) {
		db.insert(pk_table)
			.values({ ...data, id: target_id })
			.onConflictDoUpdate({
				target: sql`${pk_table}."id"`,
				set: data
			})
			.run()
	} else {
		db.insert(pk_table)
			.values({ ...{} as KindToEntry[T], id: target_id })
			.onConflictDoNothing()
			.run()
	}

	return [ident(target_id, kind), target_id]
}

// the API might return a different id (canonical), instead of the id we know (known)
// canonical <- known (into canonical)
// will completely replace rows
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

export function insert_album_artist(album_id: AlbumId, artist_id: ArtistId | ArtistId[]) {
	let values

	if (!(artist_id instanceof Array)) {
		values = [{ album_id, artist_id }]
	} else {
		values = artist_id.map(artist_id => ({ album_id, artist_id }))
	}

	db.insert($album_artist)
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

export function ident(target: Snowflake, kind: ArticleKind): Ident {
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

// inserts [ImageKind, string] into the queue
// it is in an array/tuple for deterministic JSON.stringify etc
export function images_queue_url(ident: Ident, kind: ImageKind, url: string) {
	queue_dispatch_immediate('image.download.image_url', [kind, url], ident)
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

export async function run_with_concurrency_limit<T>(arr: T[], concurrency_limit: number, next: (v: T) => Promise<void>) {
	const active_promises: Promise<void>[] = []

	for (const item of arr) {
		// wait until there's room for a new operation
		while (active_promises.length >= concurrency_limit) {
			await Promise.race(active_promises)
		}

		const next_operation = next(item)
		active_promises.push(next_operation)

		next_operation.finally(() => {
			const index = active_promises.indexOf(next_operation)
			if (index !== -1) {
				active_promises.splice(index, 1)
			}
		})
	}

	// wait for all active operations to complete
	await Promise.all(active_promises)
}

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
