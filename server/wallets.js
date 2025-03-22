import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema({
    UserId:{
        type: String,
        requred: true,
        unique: true
    },
    
    iv:{
        type: String,
        required: true,
    },
    s:{
        type: String,
        required: true
    }
});

export default mongoose.model('Member', MemberSchema);