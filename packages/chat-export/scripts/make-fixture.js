import process from "node:process"
import { bothFixtures } from "../test/fixtures.js"
import { stamp, t3Database } from "../test/t3code-fixtures.js"
import { join } from "node:path"
const options = await bothFixtures(process.argv[2])
options.t3CodeDb = join(process.argv[2], "t3/userdata/state.sqlite")
const db = await t3Database(options.t3CodeDb)
db.thread()
db.message("u1", "user", "T3 question 🦉")
db.message("a1", "assistant", "T3 answer", { created: stamp(2) })
db.close()
process.stdout.write(JSON.stringify(options) + "\n")
