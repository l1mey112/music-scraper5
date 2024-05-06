#!/bin/bash

set -e

if [ -f "root/db.sqlite" ]; then
	echo "will not delete when db exists, delete db.sqlite manually"
	exit 1
fi

# -f to avoid error if enoent
rm -rf migrations root/media
rm -f root/db.sqlite root/db.sqlite-shm root/db.sqlite-wal

bun run drizzle-kit generate:sqlite
HEAD=`ls -aht migrations/*.sql | head -1`
sh/post.py schema.ts $HEAD | sqlite3 root/db.sqlite

if [ -f sh/.dump.sh ]; then
	sh/.dump.sh
fi
