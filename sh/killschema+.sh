#!/bin/bash

set -e

sh/killschema.sh

cmds=(
	# cosmo@bousou-p
	#"track.index_spotify_track" "1rkDWkKb9J4A37J91U6eUW"
	#"track.index_youtube_video" "XwCv6Gm3Q3Q"

	# faker
	#"track.index_youtube_video" "among_fake"

	# slave vvr
	#"track.index_spotify_track" "7GHLlh8JZedHUVhsf0sC2L"
	#"track.index_youtube_video" "SZeabHMbOos"

	# deco27 songs
	"track.index_spotify_track" "2lwsum13Qj2ha3ICGCz7w8"
	"track.index_youtube_video" "owv06htaoI8"

	# inabakumori
	"track.index_spotify_track" "2zAi85TQB7mLzl8P1ySAj9"
	"track.index_youtube_video" "DeKLpgzh-qQ"
)

sh/queue_imm.ts "${cmds[@]}"
