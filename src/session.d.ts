import { User } from "./entity/User"

declare global {
    namespace Express {
        interface Session {
            userId?: string
        }
    }
}