#!/bin/bash

set -e

sh/killschema.sh

cmds=(
	# cosmo@bousou-p
	"sp_track" "1rkDWkKb9J4A37J91U6eUW"
	"yt_video" "XwCv6Gm3Q3Q"

	# faker
	"yt_video" "among_fake"
)

sh/queue_imm.ts "${cmds[@]}"
