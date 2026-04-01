import { main } from "./entrypoints/cli";

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
