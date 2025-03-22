import mongoose from "mongoose";

const DroptipSchema = new mongoose.Schema({
    droptipId: {
        type: String,
        required: true,
        unique: true
    },
    droptip: {
        type: mongoose.Schema.Types.Mixed,
        requred: true
    },
});

export default mongoose.model('Droptip', DroptipSchema);