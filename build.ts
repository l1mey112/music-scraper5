import { sql } from "drizzle-orm"
import { db, sqlite } from "./db"
import { assert, ident_make, run_with_concurrency_limit } from "./pass_misc"
import { $album_track, $source, $track_artist } from "./schema"
import { AlbumId, FSRef, Ident, ImageKind, TrackId } from "./types"
import fs from 'fs'
import { fs_hash_path, unwrap_path } from "./fs"

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
			hash -- lexograpical ordering time
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

export const ident_name_from = name_from()
export const ident_image_from = image_from()

function best_audio_source(track_id: TrackId) {
	const source = db.select({ hash: $source.hash })
		.from($source)
		.where(sql`track_id = ${track_id}`)
		.orderBy(sql`bitrate desc`)
		.get()

	// TODO: log this being ignored
	return source?.hash
}

function artist_names(track_id: TrackId): string[] {
	const artists = db.select({ artist_id: $track_artist.artist_id })
		.from($track_artist)
		.where(sql`track_id = ${track_id}`)
		.orderBy(sql`id asc`)
		.all()

	return artists.map(it => {
		const name = ident_name_from(ident_make(it.artist_id, 'artist_id'))
		assert(name)
		return name
	})
}

export async function build_album(root_wd: string, target: AlbumId) {
	const tracks = db.select({ track_id: $album_track.track_id })
		.from($album_track)
		.where(sql`album_id = ${target}`)
		.orderBy(sql`id asc`)
		.all()

	const track_targets: BuildTargetTrack[] = []

	for (const [i, it] of tracks.entries()) {
		const ident = ident_make(it.track_id, 'track_id')

		const source = best_audio_source(it.track_id)

		if (!source) {
			console.error(`build_album(${root_wd}): no audio source for track ${it.track_id}`)
			continue
		}

		track_targets.push({
			name: ident_name_from(ident),
			i: i + 1,
			artist_names: artist_names(it.track_id),
			audio_source: source,
		})
	}

	if (track_targets.length === 0) {
		return
	}

	const ident = ident_make(target, 'album_id')

	return build_target(root_wd, {
		name: ident_name_from(ident_make(target, 'album_id')),
		tracks: track_targets,

		cover_image: ident_image_from(ident)?.hash
	})
}

export async function build_single(root_wd: string, target: TrackId) {
	const name = ident_name_from(ident_make(target, 'track_id'))

	const source = best_audio_source(target)
	if (!source) {
		console.error(`build_single(${root_wd}): no audio source for track ${target}`)
		return
	}

	const single: BuildTargetTrack = {
		name,
		i: 1,
		artist_names: artist_names(target),
		audio_source: source,
	}

	const ident = ident_make(target, 'track_id')

	return build_target(root_wd, {
		name: `${name} (Single)`,
		tracks: [single],
		cover_image: ident_image_from(ident)?.hash
	})
}

type BuildTargetTrack = {
	name: string
	i: number // 1 index
	artist_names: string[]

	audio_source: FSRef
}

type BuildTarget = {
	name: string
	tracks: BuildTargetTrack[]

	cover_image?: FSRef
}

function safe_path(k: string) {
	// replace / characters with ⧸
	k = k.replace(/\//g, '\u29f8')

	// vfat file systems don't like these characters
	k = k.replace(/[:?*]/g, '')
	k = k.replace(/"/g, "'")

	return k
}

async function build_target(root_wd: string, target: BuildTarget) {
	root_wd = unwrap_path(root_wd)

	const album_wd = `${root_wd}/${safe_path(target.name)}`
	fs.mkdirSync(album_wd, { recursive: true })

	await run_with_concurrency_limit(target.tracks, 8, async (track) => {
		const dest_path = `${album_wd}/${safe_path(track.name)}.mp3`

		// ignoring
		if (await Bun.file(dest_path).exists()) {
			// TODO: log this
			console.log(`build_target: skipping ${target.name} (${dest_path})`)
			return
		} else {
			console.log(`build_target: tagging audio source for album ${target.name} and track ${track.name} (${dest_path})`)
		}

		const artist_names_together = track.artist_names.join(', ')

		try {
			let args
			if (target.cover_image) {
				args = [
					'-i', fs_hash_path(track.audio_source),
					'-i', fs_hash_path(target.cover_image),
					'-vf', "scale=-1:'min(iw,ih)',crop='min(iw,ih)':'min(iw,ih)',setsar=1:1,scale=400:400",
					'-c:v', 'mjpeg',
					'-q:v', '0',
					'-pix_fmt', 'yuvj420p', // yuvj444p doesn't work, tested on mechen m30
					'-map', '0:0',
					'-map', '1:0',
					'-id3v2_version', '3',
					'-write_id3v1', '1',
					'-metadata:s:v', 'title=Album cover',
					'-metadata:s:v', 'comment=Cover (front)',
					'-metadata', `title=${track.name}`,
					'-metadata', `artist=${artist_names_together}`,
					'-metadata', `album=${target.name}`,
					'-metadata', `track=${track.i}`,
					'-y', dest_path
				]
			} else {
				args = [
					'-i', fs_hash_path(track.audio_source),
					'-id3v2_version', '3',
					'-write_id3v1', '1',
					'-metadata', `title=${track.name}`,
					'-metadata', `artist=${artist_names_together}`,
					'-metadata', `album=${target.name}`,
					'-metadata', `track=${track.i}`,
					'-y', dest_path
				]
			}

			const proc = Bun.spawn(['ffmpeg', ...args], {
				stderr: 'pipe',
				stdout: 'pipe',
			})
			await proc.exited

			if (proc.exitCode !== 0) {
				throw new Error(`ffmpeg exited with code ${proc.exitCode}, stderr: ${await new Response(proc.stderr).text()}`)
			}
		} catch (e) {
			console.error(`failed to tag audio source for album ${target.name} and track ${track.name}`)
			console.error(e)
			assert(false)
		}
	})
}
