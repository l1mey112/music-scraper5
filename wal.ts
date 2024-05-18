import { fs_wal } from "./fs";
import fs from 'fs'
import { assert, ident_link_command } from "./pass_misc";
import { Ident, QueueEntry } from "./types";

type WalKind = 'log' | 'fatal' | 'link'

// open append only file stream, will need to sync after every write
const wal_fd = fs.openSync(fs_wal, 'a')

// log+[date]: something
// fatal+[date](pass+pass_id): error
// link+[date]: link command

export function wal_log(log: string, where?: QueueEntry<unknown>) {
	if (where) {
		write_log(`log+[${new Date()}](${where.pass}): ${log}`)
	} else {
		write_log(`log+[${new Date()}]: ${log}`)
	}
}

export function wal_pass_fatal(pass: QueueEntry<unknown>, error: string) {
	write_log(`fatal+[${new Date().toISOString()}](${pass.pass}+${pass.id}): ${error}`)
}

export function wal_link(ident: Ident) {
	write_log(`link+[${new Date().toISOString()}]: ${ident_link_command(ident)}`)
}

function write_log(line: string) {
	line = line + '\n'
	assert(fs.writeSync(wal_fd, line) == line.length)
	fs.fsyncSync(wal_fd)
}
