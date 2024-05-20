import { switch_page } from "."
import { snowflake_timestamp } from "../ids"
import { ident_id } from "../pass_misc"
import { FSRef, Ident } from "../types"

type BoxProps = {
	is_selected?: boolean
	name: string
	ident: Ident
	collaborators?: JSX.Element
	image_hash?: FSRef

	onclick?: {
		htmx_json_vals: string
	}
}

type BoxBareProps = {
	line: JSX.Element
	collaborators?: JSX.Element
	corner?: JSX.Element

	onclick?: {
		htmx_json_vals: string
	}
}

export function IdentTooltip(ident: Ident) {
	const id = ident_id(ident)
	const date = snowflake_timestamp(id)

	return <b>{ident} <span class="tooltip" data-tooltip title={date.toString()}>[?]</span></b>
}

export function TooltipIdent(ident: Ident, text: string) {
	return <a hx-post="/search_link_tooltip" hx-vals={`{"search":"${ident}","kind":"ident"}`}><span class="tooltip" data-tooltip title={ident}>{text}</span></a>
}

export function Box({ name, is_selected, ident, collaborators, image_hash, onclick }: BoxProps) {
	const topline_html = onclick
		? <pre hx-post="/select" hx-swap="none" hx-vals={onclick.htmx_json_vals} hx-trigger="click" style="cursor: pointer;">{name}</pre>
		: <pre>{name}</pre>

	let ident_html: JSX.Element | undefined

	if (ident) {
		ident_html = IdentTooltip(ident)
	}

	const image_html = image_hash
		? <img loading="lazy" src={`/media?q=${image_hash}`} />
		: <pre style="padding: 1em;" >No Image</pre>
	
	return <article class={is_selected ? 'selected' : ''} id={ident}>
		<header>
			{topline_html}
			{ident_html}
			{collaborators && <><hr />{collaborators}</>}
		</header>
		<div>
			{image_html}
		</div>
	</article>
}

export function BoxBare({ line, collaborators, corner, onclick }: BoxBareProps) {
	const topline_html = onclick
		? <div hx-post="/select" hx-swap="none" hx-vals={onclick.htmx_json_vals} hx-trigger="click" style="cursor: pointer;">{line}</div>
		: line

	return <article>
		<header>
			{topline_html}
			{collaborators && <><hr />{collaborators}</>}
		</header>
		{corner && <div>{corner}</div>}
	</article>
}
