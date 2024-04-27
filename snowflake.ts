import { Snowflake } from "./types"

const epoch = 0 /* +Date.UTC(1970, 0, 1) */

let last_timestamp = 0
let sequence = 0

// what are snowflakes?
// - https://en.wikipedia.org/wiki/Snowflake_ID

// this isn't a distributed system, so im going to change the internals
//
//  63 bit strictly positive integer (unsigned)
//   1 bit + 48 bits + 15 bits = 64 bits
// +-+----------------------------------------------------+---------------+
// |0|                     timestamp                      |   sequence    |
// +-+----------------------------------------------------+---------------+

// UPDATE: the javascript bigint type isn't DB safe, drizzle+bun:sqlite destroy
//         it at the API boundary. ive made mass notes but the gist is:
//         - snowflakes are stored as 63 (64) bit integers inside a JS bigint
//         - bigint insertion is fine, they're serialised as is
//         - bigint extraction causes issues, bun:sqlite converts them into
//           the JS number type, which is a 64 bit floating point double
//         - past 2^53 (52 bits + 1 bit implied = 53 bits in mantissa)
//           most integers are not representable, and the precision is lost
//         the solution?
//         - using anything other than integers causes overhead and distrupts
//           (fast) sorting, indexing, and querying
//         - there isn't a good one, except biting the bullet and using
//           only integers inside the interval of [0, 2^53]

// in my tests the sequence bit hovered around 200, safe cap at 500
//
// >>> # 44 bits + 9 bits = 53 bits
// >>> 2**44 / 1000 / 60 / 60 / 24 / 365
// 557.8445600081178     (can store about 557 years in here, which is annoying)

// you know? fuck the sequence bits. we aren't twitter

// im going to opt to use 5 bits of sequence, and use 48 bits of timestamp
// then just hard block when those 5 bits are exeeded
// its rare that you'll be generating more than 32 identifiers in the same mili

//  53 bit strictly positive integer (unsigned)
//   5 bits + 48 bits = 53 bits
// +------------------------------------------------+-----+
// |              timestamp  (48 bits)              | seq |
// +------------------------------------------------+-----+

// keep note that Number.MAX_SAFE_INTEGER == 2^53-1, not 2^53
// i doubt this matters, we're just chopping the bits anyway
// sources say that it is 2^53 exactly, so which is it?

export function snowflake(): Snowflake {
	const now = Date.now()

	if (last_timestamp !== now) {
		sequence = 0
		last_timestamp = now
	} else if (sequence == 32) {
		Bun.sleepSync(1)
		return snowflake()
	}
	const seq = sequence++

	const int_snowflake = BigInt(epoch + now) << 5n | BigInt(seq)

	return Number(int_snowflake)
}

export function snowflake_timestamp(snowflake: Snowflake): Date {
	return new Date(Number(BigInt(snowflake) >> 5n) + epoch)
}
