// @ts-ignore - need this for autoreloads on edit
import index from './index.html'
import { route_build, route_merge, route_search, route_select } from './search'
import { FSRef, Ident } from '../types'
import { fs_hash_path } from '../fs'
import { ServerWebSocket } from 'bun'
import { Index, switch_page } from '.'
import { route_mergeassist, route_mergetwo } from './mergeassist'

const js = Bun.file('ui/htmx.js')

interface ToString {
	toString(): string
}

const sockets = new Set<ServerWebSocket>()

export function htmx(st: ToString) {
	const st_str = st.toString()

	for (const socket of sockets) {
		socket.sendText(st_str, true)
	}
}

// TODO: this sucks but i am so goddamn lazy

export function serve_ui() {
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
				case '/search_link_tooltip': {
					switch_page('search_tooltip_link') // switches to search if you're not already on that page
					const data = await req.formData()
					route_search(String(data.get('search')!), String(data.get('kind')!) as any)
					return new Response(undefined, { status: 200 })
				}
				case '/mergeassist': {
					const data = await req.formData()
					route_mergeassist(String(data.get('kind')!) as any)
					return new Response(undefined, { status: 200 })
				}
				case '/mergetwo': {
					const data = await req.formData()
					route_mergetwo(String(data.get('a')!) as any, String(data.get('b')!) as any)
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
				case '/merge': {
					route_merge()
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
				case '/page': {
					const p = String(url.searchParams.get('p'))
					switch_page(p as any)
					return new Response("200 OK", { status: 200 }) 
				}
				default: {
					return new Response("404 Not Found", { status: 404 })
				}
			}
		},
		websocket: {
			open(ws) {
				sockets.add(ws)
				htmx(Index())
			},
			close(ws) {
				sockets.delete(ws)
			},
			message(ws, data) {}
		},
	})

	console.log(`ui: listening on http://localhost:3000/`)
}
