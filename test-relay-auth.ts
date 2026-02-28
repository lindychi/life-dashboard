#!/usr/bin/env npx tsx

/**
 * Integration test for relay key authentication on project APIs
 *
 * Tests:
 * 1. GET /api/projects with relay key
 * 2. POST /api/projects with relay key (create project)
 * 3. GET /api/projects/[id] with relay key
 * 4. PUT /api/projects/[id] with relay key (update project)
 * 5. DELETE /api/projects/[id] with relay key
 */

import { config } from "dotenv";
import * as path from "path";

config({ path: path.resolve(__dirname, ".env.local"), override: true });

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";

async function testRelayAuth() {
  console.log("🧪 Testing relay key authentication on project APIs...\n");
  console.log(`Dashboard URL: ${DASHBOARD_URL}`);
  console.log(`Relay Key: ${RELAY_API_KEY}\n`);

  let createdProjectId: string | null = null;

  try {
    // Test 1: GET /api/projects
    console.log("1️⃣ Testing GET /api/projects with relay key...");
    const listResponse = await fetch(`${DASHBOARD_URL}/api/projects`, {
      method: "GET",
      headers: {
        "x-relay-key": RELAY_API_KEY,
      },
    });

    if (!listResponse.ok) {
      throw new Error(`GET /api/projects failed: ${listResponse.status} ${await listResponse.text()}`);
    }

    const listData = await listResponse.json();
    console.log(`✅ Success! Found ${listData.projects?.length || 0} projects\n`);

    // Test 2: POST /api/projects (create)
    console.log("2️⃣ Testing POST /api/projects with relay key...");
    const createResponse = await fetch(`${DASHBOARD_URL}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": RELAY_API_KEY,
      },
      body: JSON.stringify({
        name: "Test Project (Relay Auth)",
        description: "Created via relay key authentication test",
        status: "planning",
        progress: 0,
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`POST /api/projects failed: ${createResponse.status} ${await createResponse.text()}`);
    }

    const createData = await createResponse.json();
    createdProjectId = createData.project?.id;
    console.log(`✅ Success! Created project: ${createdProjectId}\n`);

    if (!createdProjectId) {
      throw new Error("No project ID returned from create");
    }

    // Test 3: GET /api/projects/[id]
    console.log(`3️⃣ Testing GET /api/projects/${createdProjectId} with relay key...`);
    const getResponse = await fetch(`${DASHBOARD_URL}/api/projects/${createdProjectId}`, {
      method: "GET",
      headers: {
        "x-relay-key": RELAY_API_KEY,
      },
    });

    if (!getResponse.ok) {
      throw new Error(`GET /api/projects/${createdProjectId} failed: ${getResponse.status} ${await getResponse.text()}`);
    }

    const getData = await getResponse.json();
    console.log(`✅ Success! Retrieved project: ${getData.project?.name}\n`);

    // Test 4: PUT /api/projects/[id]
    console.log(`4️⃣ Testing PUT /api/projects/${createdProjectId} with relay key...`);
    const updateResponse = await fetch(`${DASHBOARD_URL}/api/projects/${createdProjectId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": RELAY_API_KEY,
      },
      body: JSON.stringify({
        status: "active",
        progress: 25,
      }),
    });

    if (!updateResponse.ok) {
      throw new Error(`PUT /api/projects/${createdProjectId} failed: ${updateResponse.status} ${await updateResponse.text()}`);
    }

    const updateData = await updateResponse.json();
    console.log(`✅ Success! Updated project status to: ${updateData.project?.status}\n`);

    // Test 5: DELETE /api/projects/[id]
    console.log(`5️⃣ Testing DELETE /api/projects/${createdProjectId} with relay key...`);
    const deleteResponse = await fetch(`${DASHBOARD_URL}/api/projects/${createdProjectId}`, {
      method: "DELETE",
      headers: {
        "x-relay-key": RELAY_API_KEY,
      },
    });

    if (!deleteResponse.ok) {
      throw new Error(`DELETE /api/projects/${createdProjectId} failed: ${deleteResponse.status} ${await deleteResponse.text()}`);
    }

    const deleteData = await deleteResponse.json();
    console.log(`✅ Success! Deleted project: ${deleteData.success}\n`);

    console.log("🎉 All tests passed! Relay key authentication is working correctly.\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);

    // Cleanup: delete test project if it was created
    if (createdProjectId) {
      console.log(`\n🧹 Cleaning up: deleting test project ${createdProjectId}...`);
      try {
        await fetch(`${DASHBOARD_URL}/api/projects/${createdProjectId}`, {
          method: "DELETE",
          headers: {
            "x-relay-key": RELAY_API_KEY,
          },
        });
        console.log("✅ Cleanup successful");
      } catch (cleanupError) {
        console.error("❌ Cleanup failed:", cleanupError);
      }
    }

    process.exit(1);
  }
}

testRelayAuth();
