#include <stdint.h>
#include <stddef.h>

// -fvisibility=hidden passed so by default all symbols are hidden
// use DLL_EXPORT to make them visible
#define DLL_EXPORT __attribute__((visibility("default")))

int acoustid_compare2(
	const int32_t *a, unsigned asize, const int32_t *b, unsigned bsize,
	int maxoffset,
	float *outp, void *malloc0(size_t size), void free(void *ptr)
);

uint32_t simhash32(const uint32_t *data, unsigned size);
unsigned hdist32(unsigned a, unsigned b);
