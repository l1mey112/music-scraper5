import { parse } from "bcp-47"
import { db } from "./db"
import { sql } from "drizzle-orm"
import { Script } from "./types"
import { $kv_store } from "./schema"

// Locale is a IETF language tag (e.g. en, jp, ja-latn)
// only storing language and script, nothing else

export function locale_from_bcp_47(code: string): Script | undefined {
	const k = parse(code)

	if (!k.language) {
		return
	}

	if (k.script) {
		return `${k.language}-${k.script}` as Script
	}

	return k.language as Script
}

export function locale_script_equal(to: Script, foreign: Script): boolean {
	if (to == foreign) {
		return true
	}
	
	const map: Record<string, Script> = {
		'ja-latn': 'en' as Script,
	}

	const mapped = map[foreign]

	if (mapped && mapped == to) {
		return true
	}

	return false
}

let _locale_current: Script | undefined

// default database locale is "en"
// repeated calls to this function will return the same cached locale
export function locale_current(): Script {
	if (_locale_current) {
		return _locale_current
	}
	
	const locale_entry = db.select({ data: $kv_store.data })
		.from($kv_store)
		.where(sql`kind = 'locale'`)
		.get() as { data: Script } | undefined

	let locale
		
	if (!locale_entry) {
		// insert into db
		db.insert($kv_store)
			.values({ kind: 'locale', data: 'en' })
			.run()

		locale = 'en' as Script
	} else {
		locale = locale_entry.data
	}

	_locale_current = locale
	return locale
}
