import { parse as tldts_parse } from "tldts"
import { db } from "../db"
import { Link } from "../types"
import { link_delete, link_insert, link_kill, link_select, run_with_concurrency_limit } from "../pass_misc"

// capture subdomain captures subdomain, matches are pushed first
// RegExp matches URL, matches are pushed
// string matches URL params, matches are pushed
type LinkMatch = {
	subdomain?: string // www -> undefined
	domain: string
	r?: RegExp // matched with stripped forward /
	m?: (string)[]
	capture_subdomain?: boolean
}

type WeakClassifyLinks = Partial<Record<Exclude<Link, 'unknown'>, LinkMatch[]>>

const weak_classify_links: WeakClassifyLinks = {
	[Link["YouTube Video"]]: [
		{ domain: 'youtube.com', r: /\/watch/, m: ['v'] },
		{ domain: 'youtube.com', r: /\/(?:v|embed|shorts|video|watch|live)\/([^\/]+)/ },
		{ domain: 'youtu.be',    r: /\/([^\/]+)/ },
	],
	[Link["YouTube Channel"]]: [
		{ domain: 'youtube.com', r: /\/channel\/([^\/]+)/ },
		// @handles require touching the network, not handled here
	],
	[Link["YouTube Playlist"]]: [
		{ domain: 'youtube.com', r: /\/playlist/, m: ['list'] },
		{ subdomain: 'music', domain: 'youtube.com', r: /\/playlist/, m: ['list'] },
	],
	[Link["Spotify Track"]]: [
		{ subdomain: 'open', domain: 'spotify.com', r: /\/track\/([^\/]+)/ },
	],
	[Link["Spotify Artist"]]: [
		{ subdomain: 'open', domain: 'spotify.com', r: /\/artist\/([^\/]+)/ },
	],
	[Link["Spotify Album"]]: [
		{ subdomain: 'open', domain: 'spotify.com', r: /\/album\/([^\/]+)/ },
	],
	[Link["Apple Music Album"]]: [
		{ subdomain: 'music', domain: 'apple.com', r: /\/\w+\/album\/[\S^\/]+\/([^\/]+)/ },
		{ subdomain: 'music', domain: 'apple.com', r: /\/\w+\/album\/([^\/]+)/ },
	],
	[Link["Piapro Item"]]: [
		{ domain: 'piapro.jp', r: /\/t\/([^\/]+)/ },
	],
	[Link["Piapro Creator"]]: [
		{ domain: 'piapro.jp', r: /\/my_page/, m: ['pid'] },
		{ domain: 'piapro.jp', r: /\/([^\/]+)/ },
	],
	[Link["Niconico Video"]]: [
		{ domain: 'nicovideo.jp', r: /\/watch\/([^\/]+)/ },
	],
	[Link["Niconico User"]]: [
		{ domain: 'nicovideo.jp', r: /\/user\/([^\/]+)/ },
	],
	[Link["Niconico Material"]]: [
		{ subdomain: 'commons', domain: 'nicovideo.jp', r: /\/material\/([^\/]+)/ },
	],
	[Link["Twitter User"]]: [
		{ domain: 'twitter.com', r: /\/([^\/]+)/ },
		{ domain: 'x.com', r: /\/([^\/]+)/ },
	],
	[Link["Karent Album"]]: [
		{ domain: 'karent.jp', r: /\/album\/([^\/]+)/ },
	],
	[Link["Karent Artist"]]: [
		{ domain: 'karent.jp', r: /\/artist\/([^\/]+)/ },
	],
	[Link.Linkcore]: [
		{ domain: 'linkco.re', r: /\/([^\/]+)/ },
	],
	[Link["Linkfire (lnk.to)"]]: [
		{ domain: 'lnk.to', r: /\/([^\/]+)/ },
	],
	[Link["Linkfire Composite (lnk.to)"]]: [
		{ domain: 'lnk.to', capture_subdomain: true, r: /\/([^\/]+)/ },
	],
}

function link_classify<T extends keyof any>(url: string, classify_links: Record<T, LinkMatch[]>): { kind: T, data: string } | undefined {
	const url_obj = new URL(url)
	const url_tld = tldts_parse(url)

	// url_tld.subdomain can be "" instead of null, they're liars

	if (url_tld.subdomain === '') {
		url_tld.subdomain = null
	}

	if (url_tld.subdomain === 'www') {
		url_tld.subdomain = null
	}

	if (url_obj.pathname.endsWith('/')) {
		url_obj.pathname = url_obj.pathname.slice(0, -1)
	}

	for (const [kind, matches] of Object.entries<LinkMatch[]>(classify_links)) {
		nmatch: for (const match of matches) {
			// undefined == null
			if (match.subdomain != url_tld.subdomain) {
				continue nmatch
			}

			if (match.domain !== url_tld.domain) {
				continue nmatch
			}

			const match_idents = []

			if (match.capture_subdomain) {
				match_idents.push(url_tld.subdomain ?? '')
			}

			if (match.r) {
				const re_match = match.r.exec(url_obj.pathname)
				if (!re_match) {
					continue nmatch
				}

				if (re_match.length > 1) {
					match_idents.push(...re_match.slice(1))
				}
			}

			if (match.m) {
				for (const m of match.m) {
					const param = url_obj.searchParams.get(m)
					if (!param) {
						continue nmatch
					}
					match_idents.push(param)
				}
			}

			return { kind: kind as T, data: match_idents.join('/') }
		}
	}

	return undefined
}

// link.classify.weak
export function pass_link_classify_weak() {
	const k = link_select()

	for (const link of k) {
		const classified = link_classify<Link>(link.data, weak_classify_links as any) // fuckit
		if (!classified) {
			continue
		}

		// TODO: this should probably be an update?
		//       im sure i did this for a good reason.
		//       i left this note here a while ago, how accurate is it really?
		//
		//       > if you're updating a link in place, you need to delete the link then insert it.
		//       > this will play nice with the unique index on it
		//

		db.transaction(db => {
			link_delete(link)
			link.kind = classified.kind
			link.data = classified.data
			link_insert(link)
		})
	}
}

// https://gist.github.com/HoangTuan110/e6eb412ed32657c841fcc2c12c156f9d

// handle tunecore links as well, they're link shorteners
// https://www.tunecore.co.jp/to/apple_music/687558

const link_shorteners_classify: Record<string, LinkMatch[]> = {
	'bitly':    [ { domain: 'bit.ly'                      } ],
	'cuttly':   [ { domain: 'cutt.ly'                     } ],
	'niconico': [ { domain: 'nico.ms'                     } ],
	'tco':      [ { domain: 't.co'                        } ],
	'xgd':      [ { domain: 'x.gd'                        } ],
	'tunecore': [ { domain: 'tunecore.co.jp', r: /\/to\// } ],
}

// link.classify.link_shorteners
export function pass_link_classify_link_shorteners() {
	let k = link_select()

	// match only the ones that are in the list
	k = k.filter(({ data }) => link_classify(data, link_shorteners_classify))

	return run_with_concurrency_limit(k, 16, async (link) => {
		const req = await fetch(link.data)

		// even if it passes through the shortener
		// 1. it might not be a valid link
		// 2. the server might not support HEAD requests (though supporting GET just fine)
		//    some servers return 404 on HEAD (200 for GET) but URL is intact
		// -  don't req HEAD, just req GET. annoying that they aren't standards compliant

		db.transaction(db => {
			// no redirect
			// most likely req.ok isn't true as well
			if (req.url === link.data) {
				link_kill(link)
				return
			}

			link_delete(link)
			link.data = req.url
			link_insert(link)
			console.log('successful', link)
		})
	})
}
