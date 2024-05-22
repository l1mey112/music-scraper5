EXT_C = compare.c ext.c

CFLAGS = -Wall -Wextra -Werror -march=native -fvisibility=hidden

PROD=1

ifdef PROD
	CFLAGS += -O3
else
	CFLAGS += -g
endif

ext.so: $(EXT_C)
	$(CC) $(CFLAGS) -shared -fPIC -o $@ $^