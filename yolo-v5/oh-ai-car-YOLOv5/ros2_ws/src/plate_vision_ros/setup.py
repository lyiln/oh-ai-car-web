from setuptools import setup


package_name = "plate_vision_ros"


setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/plate_trigger.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="jfkyx",
    maintainer_email="jfkyx@example.com",
    description="Trigger-based plate detection and OCR bridge for ROS2 Foxy.",
    license="MIT",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "plate_trigger_node = plate_vision_ros.plate_trigger_node:main",
        ],
    },
)
