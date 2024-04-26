import { sql } from "drizzle-orm";
import { db, sqlite } from "./db";
import { $album, $artist, $external_links, $locale, $queue, $spotify_track, $track, $youtube_video } from "./schema";
import { snowflake } from "./snowflake";
import { AlbumId, ArtistId, Ident, ImageKind, Link, LinkEntry, LocaleEntry, MaybePromise, QueueCmd, QueueEntry, Snowflake, TrackId } from "./types";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

// > A value with storage class NULL is considered less than any other value
// https://www.sqlite.org/datatype3.html#sort_order

// QUERY PLAN
// `--SEARCH queue USING INDEX queue.idx0 (expiry<?)
const stmt_search = sqlite.prepare<{ rowid: number, target: Ident | '', payload: string }, [number, QueueCmd]>(`
	select rowid, target, payload from queue
	where expiry <= ? and cmd = ?
	order by expiry asc nulls first
`)

// will fill in idents if they are null
export function queue_pop_fill<T = unknown>(cmd: QueueCmd, kind: 'track_id' | 'album_id' | 'artist_id'): QueueEntry<T>[] {
	const entries = stmt_search.all(Date.now(), cmd)

	const nentries = entries.map(it => {
		if (it.target === '') {
			console.log('filling target', it.rowid, it.target, it.payload, kind)
			it.target = ident_pk_bare(snowflake(), kind)
		}

		return {
			...it,
			target: it.target,
			payload: JSON.parse(it.payload) as T,
			cmd,
		}
	})

	return nentries
}

// malformed to call this function with a non-null target
export function queue_pop<T = unknown>(cmd: QueueCmd): QueueEntry<T>[] {
	const entries = stmt_search.all(Date.now(), cmd)

	const nentries = entries.map(it => {
		assert(it.target)

		return {
			...it,
			target: it.target,
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
		.set({ expiry: Date.now() + expiry_after_millis, retry_count: sql`${$queue.retry_count} + 1` })
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

function queue_identify_exiting_target(cmd: QueueCmd, payload: any): Ident | undefined {
	let target: Ident | undefined
	
	type KindColumn = 'track_id' | 'album_id' | 'artist_id'
	const map: Record<QueueCmd, [SQLiteTable, KindColumn] | null> = {
		[QueueCmd.yt_video]: [$youtube_video, 'track_id'],
		[QueueCmd.sp_track]: [$spotify_track, 'track_id'],
		[QueueCmd.image_url]: null,
	}

	const fk_table = map[cmd]
	assert(fk_table !== undefined)

	// check if target id exists already and assign the target if it does
	if (fk_table) {
		const [table, col] = fk_table

		assert(typeof payload === 'string')

		const sel = db.select({ target: sql<Snowflake>`${sql.identifier(col)}` })
			.from(table)
			.where(sql`id = ${payload}`)
			.get()

		if (sel) {
			target = ident_pk_bare(sel.target, col)
			console.log('found existing target', target, sel.target, col, cmd)
		}
	}

	return target
}

// dispatch a command to be executed immediately
export function queue_dispatch_immediate(cmd: QueueCmd, payload: any, target?: Ident) {
	target ??= queue_identify_exiting_target(cmd, payload)

	db.insert($queue)
		.values({ cmd, target, payload })
		.onConflictDoUpdate({
			target: [$queue.target, $queue.cmd, $queue.payload],
			set: {
				expiry: 0,
				retry_count: 0,
			}
		})
		.run()
}

// dispatch a command to be executed after a certain amount of time
export function queue_dispatch_later(cmd: QueueCmd, payload: any, target: Ident, expiry_after_millis: number) {	
	db.insert($queue)
		.values({ cmd, target, payload, expiry: Date.now() + expiry_after_millis })
		.onConflictDoUpdate({
			target: [$queue.target, $queue.cmd, $queue.payload],
			set: {
				expiry: Date.now() + expiry_after_millis,
				retry_count: 0,
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

type KindTo = {
	track_id: TrackId
	album_id: AlbumId
	artist_id: ArtistId
}

// ensures existence of the id in the table as well
// will create in table if doesn't exist
export function ident_unwrap<T extends 'track_id' | 'album_id' | 'artist_id'>(entry: QueueEntry, kind: T): KindTo[T] {
	let pk_table: SQLiteTable

	const id = ident_id<KindTo[T]>(entry.target)

	switch (kind) {
		case 'track_id': {
			assert(entry.target.startsWith('tr'))
			pk_table = $track
			break
		}
		case 'album_id': {
			assert(entry.target.startsWith('al'))
			pk_table = $album
			break
		}
		case 'artist_id': {
			assert(entry.target.startsWith('ar'))
			pk_table = $artist
			break
		}
		default: {
			assert(false)
		}
	}

	db.insert(pk_table)
		.values({ id })
		.onConflictDoNothing()
		.run()

	return id
}

export function ident_pk_bare(target: Snowflake, kind: 'track_id' | 'album_id' | 'artist_id'): Ident {
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
	return BigInt(id.slice(2)) as T
}

// inserts [ImageKind, string] into the queue
// it is in an array/tuple for deterministic JSON.stringify etc
export function images_queue_url(ident: Ident, kind: ImageKind, url: string) {
	queue_dispatch_immediate(QueueCmd.image_url, [kind, url], ident)
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

export function assert(condition: any, message?: string): asserts condition {
	if (!condition) {
		if (message) {
			console.error(`assertion failed: ${message}`)
		} else {
			console.error('assertion failed')
		}
		console.log(new Error().stack)
		process.exit(1)
	}
}
