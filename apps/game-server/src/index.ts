import { server } from "./app";
import { env } from "./env";

await server.listen(env.port);
console.log(`[game-server] à l'écoute sur :${env.port} (origine web autorisée : ${env.webOrigin})`);
