import { sqlite } from "../db"
import { assert, ident_classify, ident_id, merge } from "../pass_misc"
import { Ident } from "../types"
import { BoxBare, IdentTooltip, TooltipIdent } from "./Box"
import { htmx } from "./ui"

type Kind = 'similar_names_ar_al' | 'similar_names_tr'

type Pair = { a: Ident, a_name: string, b: Ident, b_name: string }

const similar_ident_prefix = (prefix: string) => `
	select distinct a.ident as a, a.text as a_name, b.ident as b, b.text as b_name
	from locale a
	inner join locale b on a.ident < b.ident
	where a.desc = 0 and b.desc = 0
	and a.ident glob '${prefix}*' and b.ident glob '${prefix}*'
	and a.text like ('%' || b.text || '%')
`

const query_similar_names_ar_al = sqlite.prepare<Pair, []>(`
	${similar_ident_prefix('ar')}
	union all
	${similar_ident_prefix('al')}
`)

const query_similar_names_tr = sqlite.prepare<Pair, []>(`
	${similar_ident_prefix('tr')}
`)

export function route_mergetwo(a: Ident, b: Ident) {
	const kind = ident_classify(a)
	assert(kind === ident_classify(b))
	
	console.log(a, b)

	const id1 = ident_id(a)
	const id2 = ident_id(b)
	merge(kind, id1, id2)

	route_mergeassist() // TODO: need a better way to reload
}

export function route_mergeassist(kind: Kind = 'similar_names_ar_al') {
	let pairs: Pair[]

	switch (kind) {
		case 'similar_names_ar_al': {
			pairs = query_similar_names_ar_al.all()
			break
		}
		case 'similar_names_tr': {
			pairs = query_similar_names_tr.all()
			break
		}
		default: {
			assert(false)
		}
	}

	const boxes: JSX.Element[] = []

	for (const { a, a_name, b, b_name } of pairs) {
		const line = <>
			<pre>{a_name} merge with {b_name}</pre>
			<b>{IdentTooltip(a)} and {IdentTooltip(b)}</b>
		</>

		const hx_vals = JSON.stringify({a, b})

		const corner = <pre style="padding: 1em; cursor: pointer;" class="box" hx-post="/mergetwo" hx-swap="none" hx-vals={hx_vals} hx-trigger="click">
			merge
		</pre>

		const left_and_right = <>
			{TooltipIdent(a, a_name)} with {TooltipIdent(b, b_name)}
		</>

		const box = BoxBare({
			line,
			corner,
			collaborators: left_and_right,
		})

		boxes.push(box)
	}

	const output = <div id="search-results" class="flex-container">
		{...boxes}
	</div>

	htmx(output)
}
