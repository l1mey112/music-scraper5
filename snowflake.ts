import { NewType } from "./types"

const epoch = 0 /* +Date.UTC(1970, 0, 1) */

let last_timestamp = 0
let sequence = 0

// what are snowflakes?
// - https://en.wikipedia.org/wiki/Snowflake_ID

// this isn't a distributed system, so im going to change the internals

//  63 bit strictly positive integer (unsigned)
//   1 bit + 48 bits + 15 bits = 64 bits
// +-+----------------------------------------------------+---------------+
// |0|                     timestamp                      |   sequence    |
// +-+----------------------------------------------------+---------------+

export type Snowflake = NewType<'Snowflake', bigint>

export function snowflake(): Snowflake {
	const now = Date.now()

	if (last_timestamp !== now) {
		sequence = 0
		last_timestamp = now
	}
	const seq = sequence++

	const snowflake = BigInt(epoch + now) << 15n | BigInt(seq)

	return snowflake as Snowflake
}

export function snowflake_timestamp(snowflake: Snowflake): Date {
	return new Date(Number(snowflake >> 15n) + epoch)
}
