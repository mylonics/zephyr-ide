#!/usr/bin/env python3
"""
Example Python client for the Zephyr IDE REST API

This script demonstrates how AI agents can interact with Zephyr IDE
programmatically through the REST API.
"""

import requests
import json
import time
import sys

class ZephyrIdeClient:
    def __init__(self, base_url="http://localhost:8080", api_key=None):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["X-API-Key"] = api_key

    def _request(self, method, endpoint, data=None):
        """Make an HTTP request to the API"""
        url = f"{self.base_url}/api/{endpoint.lstrip('/')}"
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=self.headers)
            elif method.upper() == "POST":
                response = requests.post(url, json=data, headers=self.headers)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            return response.json(), response.status_code
        except requests.RequestException as e:
            return {"success": False, "error": f"Connection error: {e}"}, 0

    def get_status(self):
        """Get extension status"""
        return self._request("GET", "/status")

    def list_projects(self):
        """List all projects"""
        return self._request("GET", "/projects")

    def get_workspace_config(self):
        """Get workspace configuration"""
        return self._request("GET", "/workspace/config")

    def build_project(self, project_name=None, build_name=None, pristine=False):
        """Build a project"""
        data = {"pristine": pristine}
        if project_name:
            data["projectName"] = project_name
        if build_name:
            data["buildName"] = build_name
        return self._request("POST", "/build", data)

    def flash_project(self, project_name=None, build_name=None):
        """Flash a project"""
        data = {}
        if project_name:
            data["projectName"] = project_name
        if build_name:
            data["buildName"] = build_name
        return self._request("POST", "/flash", data)

def main():
    """Example usage of the Zephyr IDE API client"""
    print("Zephyr IDE API Client Example")
    print("=" * 40)
    
    # Initialize client (use API key if configured)
    api_key = input("Enter API key (or press Enter if none): ").strip() or None
    client = ZephyrIdeClient(api_key=api_key)
    
    # Test connection and get status
    print("\n1. Getting extension status...")
    status_response, status_code = client.get_status()
    if status_code == 200 and status_response.get("success"):
        print(f"✓ Extension version: {status_response['data']['version']}")
        print(f"✓ Initialized: {status_response['data']['initialized']}")
        print(f"✓ West updated: {status_response['data']['westUpdated']}")
        if status_response['data']['activeProject']:
            print(f"✓ Active project: {status_response['data']['activeProject']}")
    else:
        print(f"✗ Failed to get status: {status_response.get('error', 'Unknown error')}")
        if status_code == 401:
            print("  Make sure the API server is enabled and the API key is correct")
        elif status_code == 0:
            print("  Make sure the API server is running on http://localhost:8080")
        return

    # List projects
    print("\n2. Listing projects...")
    projects_response, status_code = client.list_projects()
    if status_code == 200 and projects_response.get("success"):
        projects = projects_response["data"]
        if projects:
            print(f"✓ Found {len(projects)} project(s):")
            for name, project in projects.items():
                builds = list(project["buildConfigs"].keys())
                print(f"  - {name} (builds: {', '.join(builds)})")
        else:
            print("✓ No projects found")
    else:
        print(f"✗ Failed to list projects: {projects_response.get('error')}")

    # Get workspace config
    print("\n3. Getting workspace configuration...")
    config_response, status_code = client.get_workspace_config()
    if status_code == 200 and config_response.get("success"):
        config = config_response["data"]
        print(f"✓ Root path: {config['rootPath']}")
        print(f"✓ Setup complete: {config['initialSetupComplete']}")
        if config['activeProject']:
            print(f"✓ Active project: {config['activeProject']}")
    else:
        print(f"✗ Failed to get workspace config: {config_response.get('error')}")

    # Example build operation (only if projects exist)
    if projects_response.get("success") and projects_response["data"]:
        project_names = list(projects_response["data"].keys())
        project_name = project_names[0]
        
        print(f"\n4. Example: Building project '{project_name}'...")
        build_response, status_code = client.build_project(project_name)
        if status_code == 200 and build_response.get("success"):
            print(f"✓ Build triggered: {build_response.get('message')}")
        else:
            print(f"✗ Build failed: {build_response.get('error')}")

    print("\nAPI client example completed!")

if __name__ == "__main__":
    main()