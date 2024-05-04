import { db } from "../db"
import { link_delete, link_insert, link_kill, link_select, link_urls_unknown, run_with_concurrency_limit } from "../pass_misc"
import { Link, LinkEntry } from "../types"

// TODO: unused for now, need to be updated
//       make these return boolean as normal

// link.extrapolate.from_linkcore
export async function pass_link_extrapolate_from_linkcore() {
	let updated = false
	const k = link_select(Link.Linkcore)

	// linkcore is a distributor like karent
	// these links don't change

	// links extracted from linkcore either are the link itself or are some
	// short link that redirects to the actual link. they'll be picked out
	// in later passes, just dump everything to unknown for now

	// extract everything with #store_id_*

	// <a href="https://www.tunecore.co.jp/to/spotify/687558?lang=en"
	//    id="store_id_305"
	//    title="Available on Spotify"
	//    data-store="305">
	// <a href="https://www.tunecore.co.jp/to/deezer/687558?lang=en"
	//    id="store_id_3805"
	//    title="Available on Deezer"
	//    data-store="3805">

	await run_with_concurrency_limit(k, 16, async (link) => {
		const derived_urls: string[] = []

		// begins with store_id_
		const html_extractor = new HTMLRewriter().on('a[id^="store_id_"]', {
			element(e) {
				const href = e.getAttribute('href')
				if (href) {
					derived_urls.push(href)
				}
			}
		})

		const resp = await fetch(`https://linkco.re/${link.data}`)

		if (!resp.ok) {
			link_kill(link)
			return
		}
		
		html_extractor.transform(await resp.text())

		db.transaction(db => {
			const to_insert = link_urls_unknown(link.ident, derived_urls)
			link_insert(to_insert)
		})
		updated = true
	})

	return updated
}

// link.extrapolate.from_lnk_to
export async function pass_link_extrapolate_from_lnk_to() {
	const kinds = [Link['Linkfire (lnk.to)'], Link["Linkfire Composite (lnk.to)"]]
	
	let updated = false
	const k = link_select(kinds)

	// <a id="8f82cc1c-a2c3-4438-8a29-285983518182"
	//    data-media-serviceid="8f82cc1c-a2c3-4438-8a29-285983518182"
	//    data-linkid="a7d8cd43-5e65-46d0-b6f7-336d1f9f1020"
	//    class="music-service-list__link js-redirect"
	//    ...
	//    href="https://music.apple.com/au/album/1531679138">

	// extract everything with data-linkid

	await run_with_concurrency_limit(k, 16, async (link) => {
		const derived_urls: string[] = []

		const html_extractor = new HTMLRewriter().on('a[data-linkid]', {
			element(e) {
				const href = e.getAttribute('href')
				if (href) {
					derived_urls.push(href)
				}
			}
		})

		let url
		switch (link.kind as typeof kinds[number]) {
			case Link["Linkfire (lnk.to)"]:
				url = `https://lnk.to/${link.data}`
				break
			case Link["Linkfire Composite (lnk.to)"]:
				const split = link.data.split('/')
				url = `https://${split[0]}.lnk.to/${split[1]}`
				break
		}

		const resp = await fetch(url)

		if (!resp.ok) {
			link_kill(link)
			return
		}
		
		html_extractor.transform(await resp.text())

		db.transaction(db => {
			const to_insert = link_urls_unknown(link.ident, derived_urls)
			link_insert(to_insert)
		})
		updated = true
	})

	return updated
}
