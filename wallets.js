import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema({
    UserId:{
        type: String,
        requred: true,
        unique: true
    },
    
    wallet:{
            v: {
                type: String,
                required: true,
            },
            iv:{
                type: String,
                required: true,
            },
            wallet: {
                type: String,
                required: true,
        },
}
});

export default mongoose.model('Member', MemberSchema);