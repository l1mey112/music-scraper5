#include "lib.h"
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// no stdbit :(
// #include <stdbit.h>

#define popcnt(x) __builtin_popcount(x)

#define MATCH_BITS 14
#define MATCH_MASK ((1 << MATCH_BITS) - 1)
#define MATCH_STRIP(x) ((uint32_t)(x) >> (32 - MATCH_BITS))

#define UNIQ_BITS 16
#define UNIQ_MASK ((1 << MATCH_BITS) - 1)
#define UNIQ_STRIP(x) ((uint32_t)(x) >> (32 - MATCH_BITS))

static inline int imin(int a, int b) {
	return a < b ? a : b;
}

static inline int imax(int a, int b) {
	return a > b ? a : b;
}

// < 0 means failed to allocate memory
// ported from https://github.com/acoustid/pg_acoustid to sqlite3
int acoustid_compare2(const int32_t *a, unsigned asize, const int32_t *b, unsigned bsize, int maxoffset, float *outp, void *malloc0(size_t size), void free(void *ptr)) {
	int rc = 0;
	int numcounts = asize + bsize + 1;
	uint16_t *counts = malloc0(numcounts * sizeof(uint16_t));

	uint16_t *aoffsets = malloc0(sizeof(uint16_t) * (MATCH_MASK + 1) * 2);
	uint16_t *boffsets = aoffsets + MATCH_MASK + 1;
	uint8_t *seen = (uint8_t*)aoffsets;

	if (!counts || !aoffsets) {
		rc = -1;
		goto dealloc;
	}

	float score;

	for (unsigned i = 0; i < asize; i++) {
		aoffsets[MATCH_STRIP(a[i])] = i;
	}
	for (unsigned i = 0; i < bsize; i++) {
		boffsets[MATCH_STRIP(b[i])] = i;
	}

	int topcount = 0;
	int topoffset = 0;
	for (int i = 0; i < MATCH_MASK; i++) {
		if (aoffsets[i] && boffsets[i]) {
			int offset = aoffsets[i] - boffsets[i];
			if (maxoffset == 0 || (-maxoffset <= offset && offset <= maxoffset)) {
				offset += bsize;
				counts[offset]++;
				if (counts[offset] > topcount) {
					topcount = counts[offset];
					topoffset = offset;
				}
			}
		}
	}

	topoffset -= bsize;

	int minsize = imin(asize, bsize) & ~1;
	if (topoffset < 0) {
		b -= topoffset;
		bsize = imax(0, bsize + topoffset);
	} else {
		a += topoffset;
		asize = imax(0, asize - topoffset);
	}

	int size = imin(asize, bsize) / 2;
	if (!size || !minsize) {
		// empty matching subfingerprint
		score = 0.0;
		goto score;
	}

	int auniq = 0;
	int buniq = 0;

	memset(seen, 0, UNIQ_MASK);
	for (unsigned i = 0; i < asize; i++) {
		int key = UNIQ_STRIP(a[i]);
		if (!seen[key]) {
			auniq++;
			seen[key] = 1;
		}
	}

	memset(seen, 0, UNIQ_MASK);
	for (unsigned i = 0; i < bsize; i++) {
		int key = UNIQ_STRIP(b[i]);
		if (!seen[key]) {
			buniq++;
			seen[key] = 1;
		}
	}

	float diversity = fminf(fminf(1.0, (float)(auniq + 10) / asize + 0.5), fminf(1.0, (float)(buniq + 10) / bsize + 0.5));

	if (topcount < imax(auniq, buniq) * 0.02) {
		// top offset score is below 2% of the unique size
		score = 0.0;
		goto score;
	}

	uint64_t *adata = (uint64_t *)a;
	uint64_t *bdata = (uint64_t *)b;
	int biterror = 0;
	for (int i = 0; i < size; i++, adata++, bdata++) {
		biterror += popcnt(*adata ^ *bdata);
	}
	score = (size * 2.0 / minsize) * (1.0 - 2.0 * biterror / (64 * size));
	if (score < 0.0) {
		score = 0.0;
	}
	if (diversity < 1.0) {
		// scaling score because of duplicate items
		float newscore = powf(score, 8.0 - 7.0 * diversity);
		score = newscore;
	}
score:
	*outp = score;
dealloc:
	free(aoffsets);
	free(counts);
	return rc;
}

uint32_t simhash32(const uint32_t *data, unsigned size) {
	if (size == 0) {
		return 0;
	}

	int v[32] = {};

	for (unsigned i = 0; i < size; i++) {
		uint32_t local_hash = data[i];
		for (size_t j = 0; j < 32; j++) {
			v[j] += (local_hash & (1 << j)) ? 1 : -1;
		}
	}

	uint32_t hash = 0;
	for (size_t i = 0; i < 32; i++) {
		if (v[i] > 0) {
			hash |= (1 << i);
		}
	}

	return hash;
}

uint64_t simhash64(const uint32_t *data, unsigned size) {
	if (size == 0) {
		return 0;
	}

	int v[64] = {};

	for (unsigned i = 0; i < size; i++) {
		uint32_t local_hash = data[i];
		for (size_t j = 0; j < 32; j++) {
			v[j] += (local_hash & (1 << j)) ? 1 : -1;
		}
	}

	uint64_t hash = 0;
	for (size_t i = 0; i < 64; i++) {
		if (v[i] > 0) {
			hash |= (1 << i);
		}
	}

	return hash;
}

// returns number between 0-32, greater than 15 means they are different
uint32_t hdist32(uint32_t a, uint32_t b) {
	return popcnt(a ^ b);
}

uint64_t hdist64(uint64_t a, uint64_t b) {
	return popcnt(a ^ b);
}
