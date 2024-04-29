#!/bin/bash

set -e

sh/killschema.sh

cmds=(
	# cosmo@bousou-p
	"track.new.spotify_track" "1rkDWkKb9J4A37J91U6eUW"
	"track.new.youtube_video" "XwCv6Gm3Q3Q"

	# faker
	"track.new.youtube_video" "among_fake"
)

sh/queue_imm.ts "${cmds[@]}"
