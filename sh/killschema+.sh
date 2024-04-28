#!/bin/bash

set -e

sh/killschema.sh

cmds=(
	# cosmo@bousou-p
	"track.new.spotify_track" "1rkDWkKb9J4A37J91U6eUW"
	"track.new.youtube_video" "XwCv6Gm3Q3Q"

	# faker
	"track.new.youtube_video" "among_fake"

	# black is the new black
	"track.new.spotify_track" "56XcpXmOzxrjk1CNvqH1Av"

	# perpetual
	"track.new.spotify_track" "1EmbdGpODC0A8TB18vtJRJ"
)

sh/queue_imm.ts "${cmds[@]}"
