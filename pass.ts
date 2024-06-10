import { MaybePromise, PassHashed, QueueEntry, QueueId } from "./types"
import { PassArticle, PassIdentifier, PassIdentifierPayload, PassIdentifierTemplate, pass_article_kinds, passes, passes_settled } from "./passes"
import { db } from "./db"
import { $queue } from "./schema"
import { sql } from "drizzle-orm"
import { wal_pass_fatal } from "./wal"

class PassStopException extends Error {
	constructor(message: string) {
		super(message)
	}
}

export function pass_hash(pass: PassIdentifier): PassHashed {
	const [article, name] = pass.split('.')
	const idx = pass_article_kinds.indexOf(article as PassArticle)

	// 53 bits to work with, just use 32 + 8

	// : 32
	const low_bits = BigInt(Bun.hash.cityHash32(name))

	// : 8
	const high_bits = BigInt(idx) << 32n

	// : 40
	const combined = Number(low_bits | high_bits)

	return combined as PassHashed
}

// return upper and lower inclusive bounds
function pass_bound(article: PassArticle): [number, number] {
	const idx = pass_article_kinds.indexOf(article)

	const low = BigInt(idx) << 32n

	// 0xFFFFFFFF
	const high = BigInt(low) | 0xFFFFFFFFn

	return [Number(low), Number(high)]
}

const TRIP_COUNT_MAX = 20

type PassError = {
	kind: 'error'
	pass?: string
	error: string
	throwable?: any
}

type PassBefore = {
	kind: 'before'
	pass: string
	entries?: number
}

type PassAfter = {
	kind: 'after'
	pass: string
	msec: number
}

export const HOUR = 1000 * 60 * 60
export const DAY = HOUR * 24

export function queue_dispatch_immediate<T extends PassIdentifier>(pass: T, payload: PassIdentifierPayload<T>, preferred_time?: number) {
	db.insert($queue)
		.values({
			pass: pass_hash(pass),
			payload,
			preferred_time,
		})
		.onConflictDoNothing()
		.run()
}

// mutate the existing queue entry to retry later
// increments `retry_count` which can be used to determine if the entry should be removed after manual review
export function queue_retry_failed(entry: QueueEntry<unknown>, error: string, expiry_after_millis: number = DAY) {
	db.update($queue)
		.set({ expiry: Date.now() + expiry_after_millis, try_count: sql`${$queue.try_count} + 1` })
		.where(sql`id = ${entry.id}`)
		.run()
	wal_pass_fatal(entry, error)
}

// mutate the existing queue entry to retry later
// doesn't increment `retry_count`, this function is for steady retries
export function queue_again_later(entry: QueueEntry<unknown>, expiry_after_millis: number = DAY) {
	db.update($queue)
		.set({ expiry: Date.now() + expiry_after_millis })
		.where(sql`id = ${entry.id}`)
		.run()
}

export function queue_complete(entry: QueueEntry<unknown>) {
	db.delete($queue)
		.where(sql`id = ${entry.id}`)
		.run()
}

export function queue_known_pass(pass: string): pass is PassIdentifier {
	return pass in passes
}

export async function* pass(infinite_trip?: boolean): AsyncGenerator<PassBefore | PassAfter | PassError> {
	let changed
	let trip_count = 0

	function try_catch(e: any, pass: string): PassError {
		let error = 'exception thrown'
		let throwable = e
		if (e instanceof PassStopException) {
			error = `${e.message} (stop)`
			throwable = undefined
		}
		return {
			kind: 'error',
			pass,
			throwable,
			error,
		}
	}

	function has_settled(article: PassArticle): boolean {
		const [low, high] = pass_bound(article)

		const k = db.select({ chk: sql<number>`1` })
			.from($queue)
			.where(sql`expiry <= ${Date.now()} and pass between ${low} and ${high}`)
			.get()

		return !k
	}

	do {
		changed = false

		for (const [_name, { pass: fn, settled }] of Object.entries(passes)) {
			if (!settled || has_settled(settled)) {
				const name = _name as PassIdentifier

				const k = db.select()
					.from($queue)
					.where(sql`expiry <= ${Date.now()} and pass = ${pass_hash(name)}`)
					.orderBy(sql`id asc`)
					.all()

				if (k.length > 0) {
					const converted = k.map<QueueEntry<unknown>>(it => {
						return {
							...it,
							pass: name,
						}
					})

					yield {
						kind: 'before',
						pass: name,
						entries: k.length,
					}
					const now = performance.now()
					try {
						await fn(converted)
					} catch (e) {
						yield try_catch(e, name)
						return
					}
					yield {
						kind: 'after',
						pass: name,
						msec: performance.now() - now,
					}
					changed = true
				}
			}
		}

		for (const [name, { pass: fn, settled }] of Object.entries(passes_settled)) {
			if (!settled || has_settled(settled)) {
				yield {
					kind: 'before',
					pass: name,
				}
				const now = performance.now()
				try {
					await fn()
				} catch (e) {
					yield try_catch(e, name)
					return
				}	
				yield {
					kind: 'after',
					pass: name,
					msec: performance.now() - now,
				}
			}
		}

		trip_count++
		if (!infinite_trip && trip_count > TRIP_COUNT_MAX) {
			yield {
				kind: 'error',
				error: 'trip count exceeded',
			}
			return
		}
	} while (changed)
}

// must be called inside a pass, throws an exception
export function pass_exception(message: string): never {
	throw new PassStopException(message)
}
