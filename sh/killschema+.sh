#!/bin/bash

set -e

sh/killschema.sh

# update this as needed

stmts=(
	# cosmo@bousou-p
	"insert into spotify_track (id) values ('1rkDWkKb9J4A37J91U6eUW');"
	"insert into youtube_video (id) values ('XwCv6Gm3Q3Q');"
)

for stmt in "${stmts[@]}"; do
	echo "$stmt" | sqlite3 db.sqlite
done