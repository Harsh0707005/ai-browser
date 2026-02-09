import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config()

const app = express()

const PORT = process.env.PORT ?? 3001

app.get("/health", (req, res) => {return res.send({message: "healthy"})})

app.listen(PORT, ()=>{
    console.log(`Backend listening on ${PORT}`)
})