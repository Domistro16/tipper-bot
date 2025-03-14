import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema({
    UserId:{
        type: String,
        requred: true,
        unique: true
    },
    
    wallet:{
            privateKey: {
                type: String,
                required: true,
            },
            walletobj: {
                type: mongoose.Schema.Types.Mixed,
                required: true,
        },
}
});

export default mongoose.model('Member', MemberSchema);