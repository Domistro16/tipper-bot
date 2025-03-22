import 'dotenv/config'
import express from 'express'
import { DB_connection } from './dbconfig.js'
import routes from './router.js'
const app = express();
app.use(express.json());
const port = process.env.PORT || 800

DB_connection();
app.use('/api', routes);

app.listen(port, () => console.log(`Server is running on port ${port}`))