import { PassElement } from "./pass"
import { pass_image_download_image_url } from "./passes/image"
import { pass_album_new_spotify_album, pass_artist_new_spotify_artist, pass_track_new_spotify_track } from "./passes/spotify"
import { pass_artist_meta_spotify_supplementary } from "./passes/spotify_raw"
import { pass_track_new_youtube_video } from "./passes/youtube"

export const passes: PassElement[] = [
	{ name: 'track.new.youtube_video', fn: pass_track_new_youtube_video },
	{ name: 'track.new.spotify_track', fn: pass_track_new_spotify_track },
	{ name: 'album.new.spotify_album', fn: pass_album_new_spotify_album },
	{ name: 'artist.new.spotify_artist', fn: pass_artist_new_spotify_artist },
	{ name: 'artist.meta.spotify_artist_supplementary', fn: pass_artist_meta_spotify_supplementary },
	{ name: 'image.download.image_url', fn: pass_image_download_image_url },
]
