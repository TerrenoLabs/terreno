> `const` **AUTH\_CHALLENGE\_HEADER**: `"X-Terreno-Auth-Challenge"` = `"X-Terreno-Auth-Challenge"`

The header that carries challenge cookies. A client opts in by sending it on a challenge
request (`AUTH_CHALLENGE_EMPTY` when it holds none); only then does a response carry it.
