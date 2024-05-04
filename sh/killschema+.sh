#!/bin/bash

set -e

sh/killschema.sh

cmds=(
	# cosmo@bousou-p
	"track.index_spotify_track" "1rkDWkKb9J4A37J91U6eUW"
	"track.index_youtube_video" "XwCv6Gm3Q3Q"

	# faker
	#"track.index_youtube_video" "among_fake"

	# slave vvr
	#"track.index_spotify_track" "7GHLlh8JZedHUVhsf0sC2L"
	#"track.index_youtube_video" "SZeabHMbOos"
)

sh/queue_imm.ts "${cmds[@]}"

if [ -f sh/.dump.sh ]; then
	sh/.dump.sh
fi
