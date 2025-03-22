import "dotenv/config"
import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const secretName = 'discord-bot-private-keys'
export async function storePrivateKey(userId, privateKey) {
  try {
    // Step 1: Retrieve the existing secret
    const secretData = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
    let secretObject = JSON.parse(secretData.SecretString);

    // Step 2: Add the new key-value pair
    secretObject[userId] = privateKey;

    // Step 3: Update the secret in AWS
    await secretsClient.send(new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: JSON.stringify(secretObject)
    }));

    console.log(`✅ Secret updated! Added ${userId}`);
} catch (error) {
    console.error("❌ Error updating secret:", error);
}
  }

  
 export async function getPrivateKey(userId) {
    try {
      // Step 1: Fetch the secret from AWS
      const secretData = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
      
      // Step 2: Parse the JSON response
      const secretObject = JSON.parse(secretData.SecretString);
      
      // Step 3: Retrieve the value for the given userId
      if (secretObject[userId]) {
          console.log(`🔑 Private Key for ${userId}: ${secretObject[userId]}`);
          return secretObject[userId]; 
      } else {
          console.log(`❌ No private key found for ${userId}`);
          return null;
      }
  } catch (error) {
      console.error("❌ Error retrieving secret:", error);
  }
  }
  
