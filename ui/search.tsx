import { sqlite } from "../db"
import { AlbumId, ArtistId, FSRef, Ident, ImageKind, Script, TrackId, image_kind_tostring } from "../types"
import { assert, ident_classify, ident_classify_fallable, ident_id, ident_make } from "../pass_misc"
import { snowflake_timestamp } from "../ids"
import { send as htmx } from "./ui"

const selected = new Set<Ident>()

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
		const row = locale_selection.get(ident)

		if (!row) {
			return '[NO NAME]'
		}

		let name = row.text

		// edgy artists love zero width space
		if (name.trim().replace(/[\u200B-\u200D\uFEFF]/g, '') === '') {
			name = '[EMPTY NAME]'
		}

		return name
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

function unwrap_artists_media_from() {
	// from artist id, return all albums with artist inside and tracks with artist inside without album

	const albums = sqlite.prepare<{ album_id: AlbumId }, [ArtistId]>(`
		select distinct a.album_id
		from album_track a
		join track_artist ta on a.track_id = ta.track_id
		where ta.artist_id = ?
	`)

	const tracks = sqlite.prepare<{ track_id: TrackId }, [ArtistId]>(`
		select t.id as track_id
		from track t
		left join album_track at on t.id = at.track_id
		join track_artist ta on t.id = ta.track_id
		where ta.artist_id = ? and at.id is null
	`)

	return (artist: ArtistId) => {
		const album_ids = albums.all(artist).map(it => it.album_id)
		const track_ids = tracks.all(artist).map(it => it.track_id)

		return { album_ids, track_ids }
	}
}

const name_search = name_from()
const image_search = image_from()
const track_artist_search = track_artist_from()
const ident_exists = ident_exists_from()
const unwrap_artists_media = unwrap_artists_media_from()

const track_search = select_from('track')
const album_search = select_from('album')
const artist_search = select_from('artist')

// time added into DB (encoded as unix msec in snowflake id)
// name in default locale
// cover image if applicable
// external links
// preview audio
// collaborators on the piece of media

function tooltip_ident(ident: Ident, text: string) {
	return <a hx-target="#search-results" hx-post="/search" hx-vals={`{"search":"${ident}","kind":"ident"}`}><span class="tooltip" data-tooltip title={ident}>{text}</span></a>
}

function Box({ ident }: { ident: Ident }) {
	const id = ident_id(ident)
	const date = snowflake_timestamp(id)
	let name = name_search(ident)
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
		const collaborators = album_track_from()(ident_id<AlbumId>(ident))
		const collaborators_html: JSX.Element[] = []

		// 1. name2
		// 2. name1
		for (let i = 0; i < collaborators.length; i++) {
			const name = name_search(collaborators[i])
			collaborators_html.push(<pre>{tooltip_ident(collaborators[i], `${i + 1}. ${name}`)}</pre>)
		}

		collaborators_elem = <>{...collaborators_html}</>
	}

	const is_selected = selected.has(ident)
	const invert_vals = is_selected ? `{"ident":"${ident}"}` : `{"ident":"${ident}","state":"on"}`
	return <article class={is_selected ? 'selected' : ''} id={ident}>
		<header>
			<pre hx-post="/select" hx-swap="none" hx-vals={invert_vals} hx-trigger="click" style="cursor: pointer;">{name}</pre>
			<b>{ident} <span class="tooltip" data-tooltip title={date.toString()}>[?]</span></b>
			{collaborators_elem && <><hr />{collaborators_elem}</>}
		</header>
		<div>
			{image_html}
		</div>
	</article>
}

let currently_building = false

function unwrap_selected(): { albums: AlbumId[], singles: TrackId[] } {
	const albums: AlbumId[] = []
	const singles: TrackId[] = []

	for (const ident of selected) {
		const kind = ident_classify(ident)

		switch (kind) {
			case 'album_id': {
				albums.push(ident_id<AlbumId>(ident))
				break
			}
			case 'track_id': {
				singles.push(ident_id<TrackId>(ident))
				break
			}
			case 'artist_id': {
				const { album_ids, track_ids } = unwrap_artists_media(ident_id<ArtistId>(ident))

				albums.push(...album_ids)
				singles.push(...track_ids)
				break
			}
		}
	}

	return { albums, singles }
}

async function build(path: string) {
	console.log(selected)
	console.log(path)

	const { albums, singles } = unwrap_selected()

	console.log(albums, singles)
}

export function route_build(path: string) {
	currently_building = true
	htmx(BuildButton())

	build(path).then(() => {
		currently_building = false
		htmx(BuildButton())
	})
}

function BuildButton(): [boolean, JSX.Element] {
	if (currently_building || selected.size === 0) {
		return [false, <div id="build"></div>]
	}

	return [true, <div id="build">
		<form hx-swap="none">
			<input type="text" name="path" placeholder="path" minlength="1" required value="mnt2" />
			<button type="button" hx-post="/build" hx-trigger="click">Build</button>
		</form>
	</div>]
}

export function route_merge() {
	const idents = route_select_clear()
	htmx(MergeButton()) // update

	
}

function MergeButton(): [boolean, JSX.Element]  {
	// must have at least 2 selected
	// ident types must all be the same

	unacceptable: {
		if (currently_building) {
			break unacceptable
		}

		if (selected.size < 2) {
			break unacceptable
		}

		// check if they're all the same type

		const array = Array.from(selected)
		let kind = ident_classify(array[0])

		for (let i = 1; i < array.length; i++) {
			if (ident_classify(array[i]) !== kind) {
				break unacceptable
			}
		}

		// acceptable
		return [true, <div id="merge">
			<button type="button" hx-post="/merge" hx-trigger="click">Merge</button>
		</div>]
	}
	return [false, <div id="merge"></div>]
}

function route_select_rendender() {

	function output_map(ident: Ident) {
		const name = name_search(ident)
		return <div class="nbox">{tooltip_ident(ident, name)}</div>
	}

	// what an ugly solution
	const [has_any0, b0] = BuildButton()
	const [has_any1, b1] = MergeButton()
	const has_any = (has_any0 || has_any1) ? true : undefined

	const output = <div id="select-results">
		<div class="flex">
			{...Array.from(selected).map(output_map)}
		</div>
		{has_any && <>
			<hr />
			<div class="flex">
				{b0}
				{b1}
			</div>
		</>}
	</div>

	htmx(output)
}

function route_select_clear() {
	const idents = [...selected]
	selected.clear()

	for (const ident of idents) {
		htmx(Box({ ident })) // rerender
	}

	route_select_rendender()

	return idents
}

export function route_select(ident: Ident, state: boolean) {
	if (state) {
		selected.add(ident)
	} else {
		selected.delete(ident)
	}

	// rerender box
	htmx(Box({ ident }))

	route_select_rendender()
}

export function route_search(search: string, kind: Kind) {
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

	const output = <div id="search-results" class="flex-container">
		{...idents.map(ident => <Box ident={ident} />)}
	</div>

	htmx(output)
}
