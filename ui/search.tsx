import { sqlite } from "../db"
import { AlbumId, ArtistId, FSRef, Ident, ImageKind, Locale, TrackId, image_kind_tostring } from "../types"
import { assert, ident_classify, ident_classify_fallable, ident_id, ident_make } from "../pass_misc"
import { snowflake_timestamp } from "../ids"

const user_selections = {
	track: new Set<TrackId>(),
	album: new Set<AlbumId>(),
	artist: new Set<ArtistId>(),
}

type Kind = 'track' | 'track_by_artists' | 'album' | 'artist' | 'ident'

type ArticleMap = {
	track: TrackId
	album: AlbumId
	artist: ArtistId
}

function select_from<T extends 'track' | 'album' | 'artist'>(kind: T) {
	const query_empty = sqlite.prepare<{ id: ArticleMap[T] }, []>(`
		select id
		from ${kind}
		order by id desc
		limit 100
	`)

	// lexographical sorting on idents respects the order of the ids

	const ident_map = {
		track: 'tr',
		album: 'al',
		artist: 'ar',
	}

	const query_search = sqlite.prepare<{ ident: Ident }, [string]>(`
		select distinct ident
		from locale
		where ident glob '${ident_map[kind]}*' and text like ? and desc = 0
		order by ident desc
		limit 100
	`)

	return (search: string) => {
		if (search === '') {
			return query_empty.all().map(it => ident_make(it.id, (kind + '_id') as any))
		} else {
			// good enough search
			const like = `%${search.replaceAll(/\s+/g, '%')}%`

			return query_search.all(like).map(it => it.ident)
		}
	}
}

function name_from() {
	//const current_locale = locale_current()
	// TODO: incorporate locale

	const locale_selection = sqlite.prepare<{ text: string }, [Ident]>(`
		select text from locale
		where
			ident = ?
			and desc = 0
			--and locale = (select locale from locale where locale = ? limit 1)
			--or preferred = 1
		order by
			preferred desc
		limit 1
	`)

	return (ident: Ident) => {
		return locale_selection.get(ident)?.text ?? '[N/A]'
	}
}

function image_from() {
	const image_selection = sqlite.prepare<{ hash: FSRef, kind: ImageKind }, [Ident]>(`
		select hash, kind from image
		where ident = ?
		order by
			kind asc,
			preferred desc,
			hash
		limit 1
	`)

	return (ident: Ident) => {
		const res = image_selection.get(ident)
		if (res) {
			return res
		} else {
			return
		}
	}
}

function track_artist_from() {
	const query = sqlite.prepare<{ artist_id: ArtistId }, [TrackId]>(`
		select artist_id
		from track_artist
		where track_id = ?
		order by
			id asc
	`)

	return (track: TrackId) => {
		return query.all(track).map(it => ident_make(it.artist_id, 'artist_id'))
	}
}

function album_track_from() {
	const query = sqlite.prepare<{ track_id: TrackId }, [AlbumId]>(`
		select track_id
		from album_track
		where album_id = ?
		order by
			id asc
	`)

	return (album: AlbumId) => {
		return query.all(album).map(it => ident_make(it.track_id, 'track_id'))
	}
}

function ident_exists_from() {
	const id_exists = sqlite.prepare<{ found: 1 }, [TrackId | AlbumId | ArtistId]>(`
		select 1 as found
		from (
			select 1 as found from track where id = ?1
			union
			select 1 as found from album where id = ?1
			union
			select 1 as found from artist where id = ?1
		)
		limit 1
	`)

	return (ident: string) => {
		if (ident_classify_fallable(ident)) {
			return id_exists.get(ident_id(ident as Ident)) !== undefined
		}
		return false
	}
}

const name_search = name_from()
const image_search = image_from()
const track_artist_search = track_artist_from()
const ident_exists = ident_exists_from()

const track_search = select_from('track')
const album_search = select_from('album')
const artist_search = select_from('artist')

// time added into DB (encoded as unix msec in snowflake id)
// name in default locale
// cover image if applicable
// external links
// preview audio
// collaborators on the piece of media

function Box({ ident }: { ident: Ident }) {
	const id = ident_id(ident)	
	const date = snowflake_timestamp(id)
	const name = name_search(ident)
	const image = image_search(ident)

	const kind = ident_classify(ident)
	
	// return <div class="box">name: {name(ident)}</div>
	// name on left, everything else on right
	// use float

	let image_html
	if (image) {
		image_html = <img loading="lazy" src={`/media?q=${image.hash}`} alt={image_kind_tostring(image.kind)} />
	} else {
		image_html = <pre style="padding: 1em;" >No Image</pre>
	}

	function tooltip_ident(ident: Ident, text: string) {
		return <a hx-target="#search-results" hx-post="/search" hx-vals={`{"search":"${ident}","kind":"ident"}`}><span class="tooltip" data-tooltip title={ident}>{text}</span></a>
	}

	let collaborators_elem: JSX.Element | undefined
	if (kind === 'track_id') {
		const collaborators = track_artist_search(ident_id<TrackId>(ident))
		const collaborators_html: JSX.Element[] = []

		// name2, name1
		for (let i = 0; i < collaborators.length; i++) {
			const name = name_search(collaborators[i])
			collaborators_html.push(tooltip_ident(collaborators[i], name))
		}

		collaborators_elem = <pre>{collaborators_html.join(', ')}</pre>
	} else if (kind == 'album_id') {
		let collaborators = album_track_from()(ident_id<AlbumId>(ident))
		let collaborators_html: JSX.Element[] = []

		// 1. name2
		// 2. name1
		for (let i = 0; i < collaborators.length; i++) {
			const name = name_search(collaborators[i])
			collaborators_html.push(<pre>{tooltip_ident(collaborators[i], `${i + 1}. ${name}`)}</pre>)
		}

		collaborators_elem = <>{...collaborators_html}</>
	}

	return <article>
		<header>
			<pre>{name}</pre>
			<b>{ident} <span class="tooltip" data-tooltip title={date.toString()}>[?]</span></b>
			<hr />
			{collaborators_elem}
		</header>
		<div>
			{image_html}
		</div>
	</article>
}

export function route_search(search: string, kind: Kind): JSX.Element {
	let idents: Ident[] = []

	switch (kind) {
		case 'track': {
			idents = track_search(search)
			break
		}
		case 'album': {
			idents = album_search(search)
			break
		}
		case 'artist': {
			idents = artist_search(search)
			break
		}
		case 'track_by_artists': {
			assert(false)
			//return <div>Track by artists search</div>
			break
		}
		case 'ident': {
			if (ident_exists(search as Ident)) {
				idents = [search as Ident]
			}
			break
		}
	}

	return <>{...idents.map(ident => <Box ident={ident} />)}</>
}
