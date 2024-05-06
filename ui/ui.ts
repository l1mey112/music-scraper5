// @ts-ignore - need this for autoreloads on edit
import index from './index.html'
import { route_search } from './search'
import { db_close } from '../db'
import { FSRef } from '../types'
import { fs_hash_path } from '../fs'

const js = Bun.file('ui/htmx.js')

Bun.serve<undefined>({
	port: 3000,
	error(e) {
		console.error(e)
		return new Response("500 Internal Server Error", { status: 500 });
	},
	async fetch(req, server) {
		const url = new URL(req.url)

		switch (url.pathname) {
			case '/':
			case '/index.html': {
				// content type not known by bun
				return new Response(index, {
					headers: {
						'Content-Type': 'text/html',
					}
				})
			}
			case '/htmx.js': {
				return new Response(js)
			}
			case '/search': {
				const data = await req.formData()

				return new Response(await route_search(String(data.get('search')!), String(data.get('kind')!) as any))
			}
			case '/media': {
				const q = url.searchParams.get('q')
				if (!q) {
					return new Response("400 Bad Request", { status: 400 })
				}

				// don't bother checking if the hash is in the db
				// its most likely fine

				const path = fs_hash_path(q as FSRef)
				const file = Bun.file(path)

				if (!await file.exists()) {
					return new Response("404 Not Found", { status: 404 })
				}

				return new Response(file, {
					headers: {
						'Cache-Control': 'immutable',
					}
				})
			}
			default: {
				return new Response("404 Not Found", { status: 404 })
			}
		}
	},
})

console.log(`ui: listening on http://localhost:3000/`)

function exit() {
	db_close()
	process.exit(0)
}

process.on("SIGINT", exit)
process.on("SIGTERM", exit)
