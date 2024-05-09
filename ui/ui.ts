// @ts-ignore - need this for autoreloads on edit
import index from './index.html'
import { route_build, route_search, route_select } from './search'
import { db_close } from '../db'
import { FSRef, Ident } from '../types'
import { fs_hash_path } from '../fs'
import { ServerWebSocket } from 'bun'

const js = Bun.file('ui/htmx.js')

interface ToString {
	toString(): string
}

const sockets = new Set<ServerWebSocket>()

export function send(st: ToString) {
	const st_str = st.toString()

	for (const socket of sockets) {
		socket.sendText(st_str, true)
	}
}

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
			case '/ws': {
				const success = server.upgrade(req)
				if (success) {
					return undefined
				}
				return new Response("400 Bad Request", { status: 400 })
			}
			case '/search': {
				const data = await req.formData()
				route_search(String(data.get('search')!), String(data.get('kind')!) as any)
				return new Response(undefined, { status: 200 })
			}
			case '/select': {
				const data = await req.formData()
				route_select(String(data.get('ident')!) as Ident, data.get('state')! === 'on')
				return new Response(undefined, { status: 200 })
			}
			case '/build': {
				const data = await req.formData()
				route_build(String(data.get('path')!))
				return new Response(undefined, { status: 200 })
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
						'Cache-Control': 'public immutable max-age=31536000',
					}
				})
			}
			default: {
				return new Response("404 Not Found", { status: 404 })
			}
		}
	},
	websocket: {
		open(ws) {
			sockets.add(ws)
		},
		close(ws) {
			sockets.delete(ws)
		},
		message(ws, data) {}
	},
})

console.log(`ui: listening on http://localhost:3000/`)

function exit() {
	db_close()
	process.exit(0)
}

process.on("SIGINT", exit)
process.on("SIGTERM", exit)
